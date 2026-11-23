// The GP-50 write test (gp50/write.html): message, safety gate, one-at-a-time
// writing and the test's steps. Always the fake pedal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { slotFileName } from "../gp50/backup.js";
import { FakeGp50 } from "../gp50/fake-gp50.js";
import { buildPrst, buildRead, frameToWire, parseFrame, READS, toHex } from "../gp50/protocol.js";
import { assertPrst, buildPatchWrite, encodePatchWrite, WriteGate } from "../gp50/write-protocol.js";
import { checkAll, expectedAfter, parseReference, runStage, STAGES } from "../gp50/write-steps.js";
import { Gp50Writer } from "../gp50/writer.js";
import { Logger } from "../src/core/log.js";
import { readZip } from "../src/core/unzip.js";
import { createZip } from "../src/core/zip.js";

const CAPTURE = JSON.parse(readFileSync(new URL("fixtures/gp50_suite_write.json", import.meta.url), "utf8"));
const US_LEAD = new Uint8Array(Buffer.from(CAPTURE.prst_b64, "base64"));
const source = (f) => readFileSync(new URL(`../gp50/${f}`, import.meta.url), "utf8");

// setImmediate and no pauses: timers are 15 ms steps on Windows, and there are thousands.
function setup(opts) {
  const pedal = new FakeGp50({ writable: true, later: setImmediate, ...opts });
  const log = new Logger();
  log.debugEnabled = true;
  const writer = new Gp50Writer(pedal.input, pedal.output, log, {
    timeoutMs: 100, settleMs: 0, quietMs: 20, ackTimeoutMs: 100, frameGapMs: 0, writeSettleMs: opts?.writeSettleMs ?? 0,
  });
  return { pedal, log, writer, reference: contents(pedal) };
}

/** Every slot of the fake, as .prst. */
const contents = (pedal) => pedal.names.map((n, i) => buildPrst(n, pedal.bodies[i]));
const hexAll = (patches) => patches.map((p) => toHex(p));
const writesSent = (pedal) => pedal.sent.map((m) => parseFrame(m)).filter((f) => f.total === 29);
const yes = { confirmed: true };

test("gp50 write message: the 29 messages Suite really sent, byte for byte", () => {
  const built = encodePatchWrite(CAPTURE.slot, US_LEAD).map((m) => Buffer.from(m).toString("hex"));
  assert.equal(CAPTURE.write.length, 29);
  assert.deepEqual(built, CAPTURE.write);
});

test("gp50 write message: another slot changes only the first frame's slot byte (and its CRC)", () => {
  const a = encodePatchWrite(0, US_LEAD).map((m) => parseFrame(m).payload);
  const b = buildPatchWrite(99, US_LEAD).map((m) => parseFrame(m).payload);
  assert.deepEqual(b.slice(1), a.slice(1));
  assert.deepEqual(b[0].slice(0, 6), [0x11, 0x4f, 99, 0, 0, 0]);
  assert.deepEqual(b[0].slice(6), a[0].slice(6));
});

test("gp50 write message: damaged files and other pedals' files are refused", () => {
  assert.doesNotThrow(() => assertPrst(US_LEAD));
  for (const i of [0x14, 0x19, 0x100, 551]) {
    const bad = US_LEAD.slice();
    bad[i] ^= 1;
    assert.throws(() => buildPatchWrite(99, bad), /Damaged/, `byte ${i}`);
  }
  assert.throws(() => buildPatchWrite(99, US_LEAD.slice(0, 507)), /507 bytes/);
  const gp5 = US_LEAD.slice();
  gp5.set([0x47, 0x50, 0x2d, 0x35, 0, 0]);
  assert.throws(() => buildPatchWrite(99, gp5), /Not a GP-50 patch/);
  const noMark = US_LEAD.slice();
  noMark[0x15] = 0;
  assert.throws(() => buildPatchWrite(99, noMark), /ff ff ff ff/);
});

test("gp50 write safety: slots 55-99 only", () => {
  for (let s = 55; s <= 99; s++) assert.equal(buildPatchWrite(s, US_LEAD).length, 29);
  const bad = [...Array(55).keys(), -1, 100, 155, 255, 256 + 60, 60.5, "60", NaN, null, undefined];
  for (const s of bad) {
    assert.throws(() => buildPatchWrite(s, US_LEAD), /Refused: slot/, `build ${s}`);
    assert.throws(() => new WriteGate(s, US_LEAD), /Refused: slot/, `gate ${s}`);
  }
  for (const { map } of Object.values(STAGES)) for (const [target] of map) assert.ok(target >= 55 && target <= 99);
});

test("gp50 write safety: the gate passes exactly one whole write, in order", () => {
  const frames = buildPatchWrite(60, US_LEAD);
  const gate = new WriteGate(60, US_LEAD);
  for (const f of frames) gate.check(f);
  assert.throws(() => gate.check(frames[0]), /already complete/);
  const refuses = (msgs, why) => {
    const g = new WriteGate(60, US_LEAD);
    for (const m of msgs.slice(0, -1)) g.check(m);
    assert.throws(() => g.check(msgs.at(-1)), /Refused to send/, why);
    assert.throws(() => g.check(frames[msgs.length - 1]), /already refused/, `${why}: stays refused`);
  };
  refuses([frames[1]], "starting in the middle");
  refuses([frames[0], frames[0]], "a frame twice");
  refuses([frames[0], frames[2]], "a frame skipped");
  refuses([encodePatchWrite(0, US_LEAD)[0]], "another slot");
  refuses([frames[0], frameToWire(29, 1, new Array(19).fill(0))], "other contents");
  refuses([frames[0].with(20, frames[0][20] ^ 1)], "a damaged frame");
  refuses([frameToWire(1, 0, [0x11, 0x4f, 60, 0, 0, 0])], "a one-frame write");
  refuses([frameToWire(1, 0, [0x11, 0x43, 60, 0, 0, 0])], "a select");
  refuses([buildRead(READS.names)], "a read");
  refuses([Uint8Array.of(0xc0, 5)], "Program Change");
});

test("gp50 write safety: the one send() is right after its gate; the read-only page loads no write code", () => {
  assert.equal(source("writer.js").split(".send(").length - 1, 1);
  assert.match(source("writer.js"), /gate\.check\(msg\);\s+this\.output\.send\(msg\);/);
  for (const f of ["write-protocol.js", "write-steps.js", "write-page.js", "write.html", "page-common.js"]) assert.doesNotMatch(source(f), /\.send\(/, f);
  // Everything page.js loads, followed through.
  const seen = new Set();
  const follow = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const [, dep] of source(f).matchAll(/(?:from|import)\s*\(?\s*"\.\/([^"]+)"/g)) follow(dep);
  };
  follow("page.js");
  assert.ok(seen.has("device.js") && seen.has("page-common.js"), [...seen].join());
  for (const f of seen) assert.doesNotMatch(f, /write/, `page.js loads ${f}`);
  assert.doesNotMatch(source("index.html"), /write/);
});

test("gp50 write safety: an unconfirmed write sends nothing", async () => {
  const { pedal, writer, reference, log } = setup();
  for (const confirmed of [undefined, false, "yes", 1]) {
    await assert.rejects(writer.writeSlotPatch(99, US_LEAD, { confirmed }), /wasn't confirmed/);
    const r = await runStage(writer, "first", reference, { log, confirmed });
    assert.match(r.problem, /wasn't confirmed/);
    assert.deepEqual(r.written, []);
  }
  assert.equal(pedal.sent.length, 0);
});

test("gp50 writing: one patch, every frame acknowledged before the next, read back the same", async () => {
  const { pedal, writer, log } = setup();
  let outstanding = 0;
  let most = 0;
  pedal.ackFaults = (acks) => {
    most = Math.max(most, ++outstanding);
    return acks;
  };
  const deliver = pedal._deliver.bind(pedal);
  pedal._deliver = (frames) => {
    outstanding--;
    deliver(frames);
  };
  const r = await writer.writeSlotPatch(99, US_LEAD, yes);
  assert.deepEqual([r.frames, most], [29, 1]);
  const back = await writer.readSlotPatch(99);
  assert.equal(back.name, "US Lead");
  assert.equal(toHex(back.prst), toHex(US_LEAD));
  assert.deepEqual([pedal.stored, pedal.refused], [[99], []]);
  assert.match(log.text(), /Wrote slot 99: 29 frames, all acknowledged/);
});

test("gp50 writing: an acknowledgement missing every time: 3 attempts, nothing stored, then nothing more is written", async () => {
  for (const lost of [0, 12, 28]) {
    const { pedal, writer, log } = setup({ ackFaults: (acks, i) => (i === lost ? [] : acks) });
    await assert.rejects(writer.writeSlotPatch(99, US_LEAD, yes), new RegExp(`frame ${lost + 1} of 29: not acknowledged within 100 ms \\(attempt 3 of 3\\)`));
    assert.equal(writesSent(pedal).length, 3 * (lost + 1));
    assert.equal(log.text().split("Starting this patch again").length - 1, 2);
    pedal.ackFaults = (acks) => acks;
    await assert.rejects(writer.writeSlotPatch(98, US_LEAD, yes), /stopped earlier/);
    assert.equal(writesSent(pedal).length, 3 * (lost + 1));
    assert.deepEqual(pedal.stored, []);
    assert.equal((await writer.readSlotPatch(99)).name, "Fake 99", "reading still works");
  }
});

test("gp50 writing: a held-up acknowledgement (Q9), a lost frame, or the pedal's 'not stored': the patch is started again", async () => {
  const check = async (s, frame, why) => {
    const r = await s.writer.writeSlotPatch(99, US_LEAD, yes);
    assert.deepEqual([r.attempts, s.pedal.stored], [2, [99]], why);
    assert.equal(toHex((await s.writer.readSlotPatch(99)).prst), toHex(US_LEAD), why);
    assert.match(s.log.text(), new RegExp(`frame ${frame} of 29: .*attempt 1 of 3`), why);
    assert.equal((await s.writer.writeSlotPatch(98, US_LEAD, yes)).attempts, 1, `${why}: the next patch is fine`);
  };
  for (const k of [0, 13, 26, 28]) {
    // As seen: it came with the pedal's next message.
    let s = setup();
    const deliver = s.pedal._deliver.bind(s.pedal);
    let held = null;
    let acks = 0;
    s.pedal._deliver = (frames) => {
      if (acks++ === k) held = frames;
      else {
        deliver([...(held ?? []), ...frames]);
        held = null;
      }
    };
    if (k < 28) await check(s, k + 1, `acknowledgement ${k} held up`);
    else {
      // The patch was stored; writing it again does no harm.
      assert.equal((await s.writer.writeSlotPatch(99, US_LEAD, yes)).attempts, 2);
      assert.deepEqual(s.pedal.stored, [99, 99]);
    }
    assert.match(s.log.text(), /Before starting again: 1 late acknowledgement/);

    s = setup();
    const send = s.pedal.output.send;
    let n = 0;
    s.pedal.output.send = (msg) => { if (n++ !== k) send(msg); };
    await check(s, k + 1, `frame ${k} lost`);
    assert.match(s.log.text(), /Before starting again: 0 late/);
  }
  const s = setup();
  let once = true;
  s.pedal.ackFaults = (acks, i) => {
    if (i === 20 && once) {
      once = false;
      s.pedal.output.send(buildRead(READS.slot)); // another program reading meanwhile
    }
    return acks;
  };
  await check(s, 29, "a read in the middle");
  assert.match(s.log.text(), /answered 14 08 01, expected 14 08 00: it didn't store the patch/);
});

test("gp50 writing: 'not stored' every time stops it after 3 attempts; the pedal not answering the read between stops it at once", async () => {
  let s = setup({ ackFaults: (acks, i) => (i === 28 ? [frameToWire(1, 0, [0x14, 0x08, 0x01])] : acks) });
  await assert.rejects(s.writer.writeSlotPatch(99, US_LEAD, yes), /didn't store the patch \(attempt 3 of 3\)/);
  s = setup({ ackFaults: (acks, i) => (i === 4 ? [] : acks), faults: () => [] });
  await assert.rejects(s.writer.writeSlotPatch(99, US_LEAD, yes), /Reading slot: no reply at all/);
  assert.equal(writesSent(s.pedal).length, 5);
  await assert.rejects(s.writer.writeSlotPatch(99, US_LEAD, yes), /stopped earlier/);
});

test("gp50 writing: an unknown answer, or one acknowledgement too many, stops it at once", async () => {
  const ack = frameToWire(1, 0, [0x14, 0x08, 0x00]);
  let s = setup({ ackFaults: (acks, i) => (i === 4 ? [frameToWire(1, 0, [0x14, 0x08, 0x02])] : acks) });
  await assert.rejects(s.writer.writeSlotPatch(99, US_LEAD, yes), /frame 5 of 29: the pedal answered 14 08 02/);
  assert.equal(writesSent(s.pedal).length, 5);
  s = setup({ writeSettleMs: 10, ackFaults: (acks, i) => (i === 4 ? [ack, ack] : acks) });
  await assert.rejects(s.writer.writeSlotPatch(99, US_LEAD, yes), /6 acknowledgements for 5 frames/);
  s = setup({ writeSettleMs: 10, ackFaults: (acks, i) => (i === 28 ? [ack, ack] : acks) });
  await assert.rejects(s.writer.writeSlotPatch(99, US_LEAD, yes), /30 acknowledgements for 29 frames/);
});

test("gp50 writing: what the pedal sends by itself meanwhile is logged and isn't taken for an acknowledgement", async () => {
  const { pedal, writer, log } = setup({ ackFaults: (acks) => [frameToWire(1, 0, [0x12, 0x1b, 0x02]), ...acks] });
  await writer.writeSlotPatch(99, US_LEAD, yes);
  assert.match(log.text(), /unasked: 12 1b 02/);
  assert.deepEqual(pedal.stored, [99]);
  const alone = setup({ ackFaults: () => [frameToWire(1, 0, [0x12, 0x1b, 0x02])] });
  await assert.rejects(alone.writer.writeSlotPatch(99, US_LEAD, yes), /frame 1 of 29: not acknowledged/);
});

test("gp50 writing: the pedal unplugged, or the port failing, mid-write", async () => {
  let s = setup();
  s.pedal.ackFaults = (acks, i) => {
    if (i === 6) s.writer.close();
    return acks;
  };
  await assert.rejects(s.writer.writeSlotPatch(99, US_LEAD, yes), /frame 7 of 29: the connection was closed/);
  assert.equal(writesSent(s.pedal).length, 7);
  s = setup(); // between two frames
  s.writer.frameGapMs = 40;
  s.pedal.ackFaults = (acks, i) => {
    if (i === 1) setTimeout(() => s.writer.close(), 10);
    return acks;
  };
  await assert.rejects(s.writer.writeSlotPatch(99, US_LEAD, yes), /frame 3 of 29: the connection was closed/);
  assert.equal(writesSent(s.pedal).length, 2);
  s = setup();
  s.pedal.output.send = () => { throw new Error("port gone"); };
  await assert.rejects(s.writer.writeSlotPatch(99, US_LEAD, yes), /frame 1 of 29: port gone/);
});

test("gp50 reference: a complete zip is read; a missing, doubled, damaged or misnamed file is refused", async () => {
  const { reference } = setup();
  const files = reference.map((data, i) => ({ name: slotFileName(i, `Fake ${i}`), data }));
  const parse = async (list) => parseReference(await readZip(createZip(list)));
  assert.deepEqual(hexAll(await parse(files)), hexAll(reference));
  await assert.rejects(parse(files.filter((_, i) => i !== 41 && i !== 42)), /no patch for slots 41-42/);
  await assert.rejects(parse([...files, { name: "07-Again.prst", data: files[7].data }]), /Two files for slot 7/);
  await assert.rejects(parse(files.with(3, { ...files[3], data: files[3].data.with(99, 1) })), /03-Fake 3\.prst: Damaged/);
  await assert.rejects(parse(files.with(3, { ...files[3], name: "notes.txt" })), /isn't named like/);
  await assert.rejects(parse([]), /no patch for slots 0-99/);
});

test("gp50 steps: the whole test, one patch, copy 0-44 into 55-99, put it back, each checked over all 100", async () => {
  const { pedal, writer, log, reference } = setup();
  const check = (stage) => checkAll(writer, expectedAfter(stage, reference), { log });
  assert.equal((await check("reference")).pass, true);
  assert.equal((await check("first")).pass, false, "the check can fail: nothing written yet");

  let r = await runStage(writer, "first", reference, { log, ...yes });
  assert.deepEqual([r.problem, r.verified, r.selectedBefore, r.selectedAfter], [null, [99], 2, 2]);
  assert.deepEqual(pedal.stored, [99]);
  let c = await check("first");
  assert.deepEqual([c.pass, c.compared], [true, 100]);
  c = await check("reference");
  assert.deepEqual([c.pass, c.differing.map((d) => d.slot)], [false, [99]]);

  r = await runStage(writer, "copy", reference, { log, ...yes });
  const targets = Array.from({ length: 45 }, (_, i) => 55 + i);
  assert.deepEqual([r.problem, r.verified], [null, targets]);
  assert.deepEqual(hexAll(contents(pedal)), hexAll([...reference.slice(0, 55), ...reference.slice(0, 45)]));
  assert.equal((await check("copy")).pass, true);

  r = await runStage(writer, "reference", reference, { log, ...yes });
  assert.deepEqual([r.problem, r.verified], [null, targets]);
  assert.deepEqual(hexAll(contents(pedal)), hexAll(reference));
  assert.equal((await check("reference")).pass, true);
  assert.deepEqual(pedal.refused, []);
  const firstFrames = writesSent(pedal).filter((f) => f.index === 0);
  assert.equal(firstFrames.length, 1 + 45 + 45);
  for (const f of firstFrames) assert.ok(f.payload[2] >= 55 && f.payload[2] <= 99);
});

test("gp50 steps: a read-back difference stops it, telling a stored one from a changing one", async () => {
  let s = setup({ storeFault: (slot, data) => (slot === 57 ? data.with(40, data[40] ^ 1) : data) });
  let r = await runStage(s.writer, "copy", s.reference, { log: s.log, ...yes });
  // 0x19 + 40, and the file's CRC byte, which follows the contents
  assert.match(r.problem, /Slot 57 read back different .*\(2 bytes, at 0x14, 0x41\); the same in 4 reads/);
  assert.deepEqual([r.written, r.verified, s.pedal.stored], [[55, 56, 57], [55, 56], [55, 56, 57]]);

  s = setup();
  let reads = 0;
  const answer = s.pedal._answer.bind(s.pedal);
  s.pedal._answer = (fn, args) => {
    const data = answer(fn, args);
    return fn === 0x4f && args[0] === 99 && ++reads === 2 ? data.with(300, data[300] ^ 1) : data;
  };
  r = await runStage(s.writer, "first", s.reference, { log: s.log, ...yes });
  assert.match(r.problem, /changed between reads/);
});

test("gp50 steps: a patch that isn't in the reference is never overwritten, except one this page wrote", async () => {
  const { pedal, writer, log, reference } = setup();
  pedal.names[56] = "My own";
  const r = await runStage(writer, "copy", reference, { log, ...yes });
  assert.match(r.problem, /Slot 56 holds "My own", which isn't in the reference zip; it wasn't overwritten/);
  assert.deepEqual([r.written, pedal.stored], [[55], [55]]);

  const touched = new Set();
  const s = setup({ storeFault: (_, data) => data.with(40, data[40] ^ 1) });
  assert.match((await runStage(s.writer, "first", s.reference, { log: s.log, touched, ...yes })).problem, /read back different/);
  s.pedal.storeFault = (_, data) => data;
  const again = await runStage(s.writer, "first", s.reference, { log: s.log, touched, ...yes });
  assert.deepEqual([again.problem, again.verified], [null, [99]]);
});

test("gp50 steps: nothing is written while a slot from 55 to 99 is selected, also when that changes midway", async () => {
  const { pedal, writer, log, reference } = setup({ slot: 55 });
  let r = await runStage(writer, "first", reference, { log, ...yes });
  assert.match(r.problem, /on slot 55; select one from 0 to 54/);
  assert.deepEqual([r.written, writesSent(pedal).length], [[], 0]);
  pedal.slot = 54;
  r = await runStage(writer, "copy", reference, { log, ...yes, onProgress: (done) => { if (done === 2) pedal.slot = 80; } });
  assert.match(r.problem, /on slot 80/);
  assert.deepEqual([r.verified, r.selectedBefore, r.selectedAfter], [[55, 56], 54, 80]);
});

test("gp50 steps: stopping finishes the patch being written and no more", async () => {
  const { pedal, writer, log, reference } = setup();
  let done = 0;
  const r = await runStage(writer, "copy", reference, { log, ...yes, onProgress: (d) => { done = d; }, isCancelled: () => done >= 3 });
  assert.deepEqual([r.cancelled, r.problem, r.verified, pedal.stored], [true, null, [55, 56, 57], [55, 56, 57]]);
});

test("gp50 check: a differing or unread slot, or a stopped read, never passes", async () => {
  const { pedal, writer, log, reference } = setup();
  const check = (opts) => checkAll(writer, reference, { log, ...opts });
  pedal.bodies[73] = pedal.bodies[73].with(510, 99);
  let c = await check();
  assert.deepEqual([c.pass, c.differing.map((d) => [d.slot, d.offsets])], [false, [[73, [0x14, 551]]]]);
  pedal.bodies[73] = [...reference[73].slice(0x29)];
  assert.equal((await check()).pass, true);
  assert.equal((await check({ isCancelled: () => true })).pass, false);
  pedal.faults = (f, fn, args) => (fn === 0x4f && args[0] === 9 ? [] : f);
  c = await check();
  assert.deepEqual([c.pass, c.compared, c.failed], [false, 99, [9]]);
});

test("gp50 writing: a late acknowledgement after the read between is waited for; closing never starts again", async () => {
  const s = setup();
  const deliver = s.pedal._deliver.bind(s.pedal);
  let acks = 0;
  s.pedal._deliver = (frames) => {
    if (acks++ === 6) setTimeout(() => deliver(frames), 180); // after the timeout, and after the read's answer
    else deliver(frames);
  };
  s.writer.quietMs = 300;
  const r = await s.writer.writeSlotPatch(99, US_LEAD, yes);
  assert.equal(r.attempts, 2);
  assert.match(s.log.text(), /Before starting again: 1 late/);

  const c = setup({ ackFaults: (a, i) => (i === 3 ? [] : a) });
  setTimeout(() => c.writer.close(), 50);
  await assert.rejects(c.writer.writeSlotPatch(99, US_LEAD, yes), /closed|not acknowledged/);
  assert.equal(writesSent(c.pedal).length, 4);
});
