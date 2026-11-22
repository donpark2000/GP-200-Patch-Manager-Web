// The GP-50 read-only experiment (gp50/): messages, reading, and the safety gate.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Gp50Reader, isGp50Name } from "../gp50/device.js";
import { FakeGp50 } from "../gp50/fake-gp50.js";
import {
  assertReadOnly, buildPrst, buildRead, buildSlotRead, crc8, decodeNames, decodeSettings, decodeSlot, decodeSlotPatch, diffOffsets,
  frameToWire, parseFrame, READS, toHex,
} from "../gp50/protocol.js";
import { Logger } from "../src/core/log.js";

const unhex = (s) => s.match(/../g).map((h) => parseInt(h, 16));

function setup(opts) {
  const pedal = new FakeGp50(opts);
  const log = new Logger();
  log.debugEnabled = true;
  return { pedal, log, reader: new Gp50Reader(pedal.input, pedal.output, log, { timeoutMs: 100, settleMs: 0 }) };
}

// Real messages (Valeton Suite importing a patch into a GP-50, and the
// pedal's answer), captured by drewmerc302/valeton-gp50 (MIT).
const SUITE_WRITE = unhex("f0010b010d000001030101040f0000000000000000050505030200040c060506010604000000000000000000000000f7");
const PEDAL_ACK = unhex("f00b02000100000003010400080000f7");

test("gp50 frames: a real Suite message decodes, CRC and all", (t) => {
  const f = parseFrame(SUITE_WRITE);
  t.diagnostic(JSON.stringify(f));
  assert.equal(f.ok, true, f.problem);
  assert.equal(f.total, 29);
  assert.deepEqual(f.payload.slice(0, 2), [0x11, 0x4f]);
  assert.equal(String.fromCharCode(...f.payload.slice(6, 13)), "US Lead");
  assert.equal(toHex(frameToWire(f.total, f.index, f.payload)), toHex(SUITE_WRITE), "and builds back the same");
});

test("gp50 frames: damaged messages are refused, with the reason", () => {
  const good = Array.from(buildRead(READS.names));
  const flipped = [...good];
  flipped[10] ^= 1;
  assert.match(parseFrame(flipped).problem, /CRC/);
  assert.match(parseFrame(good.slice(0, -1)).problem, /complete/);
  assert.match(parseFrame([0xf0, ...good, 0xf7]).problem, /nibbles/, "Chrome 152's doubled F0/F7");
  assert.match(parseFrame([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]).problem, /nibbles/);
  assert.match(parseFrame([0xf0, 1, 2, 3, 0xf7]).problem, /at least 8/);
  assert.equal(parseFrame([]).ok, false);
});

test("gp50 safety: of the plain reads, only the four may be sent", () => {
  for (const fn of Object.values(READS)) assert.doesNotThrow(() => assertReadOnly(buildRead(fn)));
  const refuse = (msg, why) => assert.throws(() => assertReadOnly(msg), /Refused/, why);
  refuse(SUITE_WRITE, "a patch write");
  for (const fn of Object.values(READS)) refuse(frameToWire(1, 0, [0x11, fn]), "the same function as a change");
  refuse(frameToWire(1, 0, [0x12, 0x3f]), "a read that isn't listed");
  refuse(frameToWire(1, 0, [0x12, 0x41, 0]), "a read with arguments");
  refuse(frameToWire(2, 0, [0x12, 0x41]), "one frame of several");
  refuse([0xc0, 5], "Program Change");
  refuse([0xb0, 0, 5], "Control Change");
  refuse([], "nothing");
  assert.throws(() => buildRead(0x3f), /Refused/);
});

test("gp50 safety: a slot read for slots 0-99 only, and never its write twin", () => {
  for (let s = 0; s < 100; s++) assert.doesNotThrow(() => assertReadOnly(buildSlotRead(s)));
  // VLTN's own test vector for slot 55.
  assert.equal(toHex(buildSlotRead(55)), "f0 04 0a 00 01 00 00 00 06 01 02 04 0f 03 07 00 00 00 00 00 00 f7");
  for (const s of [100, 255, -1, 256, 1.5, NaN, "x", undefined]) assert.throws(() => buildSlotRead(s), `slot ${s}`);
  const refuse = (payload, total = 1) => assert.throws(() => assertReadOnly(frameToWire(total, 0, payload)), /Refused/, toHex(payload));
  refuse([0x11, 0x4f, 51, 0, 0, 0]); // the patch write
  refuse([0x11, 0x4f]);
  refuse([0x12, 0x4f]); // no slot
  refuse([0x12, 0x4f, 51, 0, 0]);
  refuse([0x12, 0x4f, 51, 0, 0, 0, 0]);
  refuse([0x12, 0x4f, 51, 1, 0, 0]);
  refuse([0x12, 0x4f, 51, 0, 0, 1]);
  refuse([0x12, 0x46, 51, 0, 0, 0]); // same shape, another function
  refuse([0x12, 0x4f, 51, 0, 0, 0], 29);
});

test("gp50 safety: one send() in the experiment, right after the gate; none in the page", () => {
  const read = (f) => readFileSync(new URL(`../gp50/${f}`, import.meta.url), "utf8");
  assert.equal(read("device.js").split(".send(").length - 1, 1);
  assert.match(read("device.js"), /assertReadOnly\(msg\);\s+this\.output\.send\(msg\);/);
  for (const f of ["page.js", "protocol.js", "index.html"]) assert.doesNotMatch(read(f), /\.send\(/, f);
});

test("gp50 is not published: outside src/, not in the publish step, no link from the live page", () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  assert.doesNotMatch(read(".github/workflows/ci.yml"), /gp50/i);
  assert.doesNotMatch(read("index.html"), /gp50\//i);
});

test("gp50 reading: firmware, slot, names and patch", async () => {
  const { pedal, reader } = setup();
  assert.equal((await reader.readSettings()).firmware, "1.1.0");
  assert.equal(await reader.readSlot(), 2);
  const names = await reader.readNames();
  assert.equal(names.length, 100);
  assert.equal(names[99], "Fake 99");
  assert.deepEqual(await reader.readPatchBody(), pedal.body);
  assert.deepEqual(pedal.refused, []);
});

test("gp50 reading: any slot without selecting it, the same file as reading it selected", async () => {
  const { pedal, reader } = setup();
  const { name, prst } = await reader.readSlotPatch(51);
  assert.equal(name, "Fake 51");
  assert.deepEqual([...prst.slice(0x29)], pedal.bodies[51]);
  assert.equal(await reader.readSlot(), 2, "still on the slot it was on");
  pedal.slot = 51;
  assert.deepEqual(diffOffsets(prst, buildPrst("Fake 51", await reader.readPatchBody())), []);
  assert.deepEqual(pedal.refused, []);
});

test("gp50 reading: a slot read that isn't answered, or in an unexpected form, fails saying so; a bad slot is never sent", async () => {
  let faults = () => [];
  const { pedal, reader } = setup({ faults: (f, fn) => faults(f, fn) });
  await assert.rejects(reader.readSlotPatch(51), /slot 51's patch: no reply at all/);
  faults = (f) => f.filter((_, i) => i !== 28);
  await assert.rejects(reader.readSlotPatch(51), /got 28 of 29 frames, missing 28/);
  faults = (f) => f;
  pedal.bodies[51] = pedal.bodies[51].slice(1);
  await assert.rejects(reader.readSlotPatch(51), /530 bytes, expected 531/);
  assert.throws(() => decodeSlotPatch(new Array(531).fill(0)), /expected ff ff ff ff/);
  const sent = pedal.sent.length;
  await assert.rejects(reader.readSlotPatch(100), /Refused/);
  assert.equal(pedal.sent.length, sent);
});

test("gp50 compare: equal, changed and shorter files", () => {
  assert.deepEqual(diffOffsets([1, 2, 3], [1, 2, 3]), []);
  assert.deepEqual(diffOffsets([1, 2, 3], [1, 9, 3]), [1]);
  assert.deepEqual(diffOffsets([1, 2, 3], [1, 2]), [2]);
});

test("gp50 reading: requests asked for together go out one at a time", async () => {
  const { pedal, reader } = setup();
  const names = reader.readNames();
  const slot = reader.readSlot();
  let sentWhenNamesDone = null;
  names.then(() => { sentWhenNamesDone = pedal.sent.length; });
  await Promise.all([names, slot]);
  assert.equal(sentWhenNamesDone, 1);
  assert.equal(pedal.sent.length, 2);
});

test("gp50 reading: frames out of order are fine", async () => {
  const { pedal, reader } = setup({ faults: (frames) => [frames[0], ...frames.slice(1).reverse()] });
  assert.deepEqual(await reader.readPatchBody(), pedal.body);
});

test("gp50 reading: no reply, a missing frame and a bad frame fail saying so; the next read works", async () => {
  let faults = () => [];
  const { reader, log } = setup({ faults: (f, fn) => faults(f, fn) });
  await assert.rejects(reader.readNames(), /no reply at all/);
  faults = (f) => f.filter((_, i) => i !== 5);
  await assert.rejects(reader.readPatchBody(), /got 26 of 27 frames, missing 5/);
  faults = (f) => f.map((m, i) => (i === 3 ? m.map((b, k) => (k === 20 ? b ^ 1 : b)) : m));
  await assert.rejects(reader.readPatchBody(), /missing 3/);
  assert.match(log.text(), /Unrecognised message \(CRC/);
  faults = (f) => f;
  assert.equal(await reader.readSlot(), 2);
});

test("gp50 reading: a patch of the wrong size (a GP-5's 466 bytes) is refused", async () => {
  const { pedal, reader } = setup();
  pedal.body = pedal.body.slice(0, 466);
  await assert.rejects(reader.readPatchBody(), /466 bytes, expected 511/);
});

test("gp50 reading: what the pedal sends by itself is logged, also during a read", async () => {
  const { pedal, reader, log } = setup();
  pedal.emit([0x12, 0x43, 7, 0]);
  assert.match(log.text(), /unasked: 12 43 07 00/);
  pedal.input.onmidimessage({ data: Uint8Array.from(PEDAL_ACK) });
  assert.match(log.text(), /unasked: 14 08 00/, "a real pedal message");
  const read = reader.readSlot();
  await Promise.resolve();
  pedal.emit([0x11, 0x48, 0, 0, 0, 0]);
  assert.equal(await read, 2);
  assert.match(log.text(), /during a read: 11 48/);
});

test("gp50 replies: bad settings, slot and names data are refused", () => {
  assert.throws(() => decodeSettings([1, 1, 4, 0, 1]), /past the end/);
  assert.throws(() => decodeSettings([1, 1]), /past the end/);
  assert.equal(decodeSettings([]).firmware, null);
  assert.throws(() => decodeSlot([100, 0]), /expected 0-99/);
  assert.throws(() => decodeSlot([1]), /at least 2/);
  assert.throws(() => decodeNames(new Array(1980).fill(0)), /expected 2000/);
  assert.throws(() => decodeNames(new Array(2000).fill(0)), /says it is slot 0/);
});

test("gp50 .prst: layout and CRC", () => {
  const body = Array.from({ length: 511 }, (_, i) => i & 0xff);
  const p = buildPrst("US Lead", body);
  assert.equal(p.length, 552);
  assert.equal(String.fromCharCode(...p.slice(0, 5)), "GP-50");
  assert.equal(p[0x14], crc8(p.slice(0x15)));
  assert.equal(String.fromCharCode(...p.slice(0x19, 0x20)), "US Lead");
  assert.deepEqual([...p.slice(0x29)], body);
  assert.throws(() => buildPrst("x", body.slice(1)), /expected 511/);
});

test("gp50 ports: GP-50 only", () => {
  for (const n of ["GP-50", "GP-50 MIDI 1"]) assert.equal(isGp50Name(n), true, n);
  for (const n of ["GP-5", "GP-500", "GP-200", "", undefined]) assert.equal(isGp50Name(n), false, String(n));
});
