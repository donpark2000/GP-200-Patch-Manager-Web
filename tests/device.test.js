// The device layer against a fake pedal: normal reads, glitches, timeouts.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkDump, findGp200Ports, GP200, plannedWriteMs, ReadError, slowWriteWarning, WRITE_TIMING,
} from "../src/core/device.js";
import { Logger } from "../src/core/log.js";
import { exportPrst } from "../src/core/prst.js";
import { skeletonBytes } from "../src/core/skeleton.js";
import { assembleChunks } from "../src/core/sysex.js";
import { baseDump, dumpWithName } from "./helpers/fixtures.js";
import { FakePedal } from "./helpers/fake-pedal.js";

function setup(pedalOpts = {}, devOpts = {}) {
  const pedal = new FakePedal({ defaultDump: baseDump(), ...pedalOpts });
  const log = new Logger();
  log.debugEnabled = true;
  const dev = new GP200({ input: pedal.input, output: pedal.output, log, timeoutMs: 50, ...devOpts });
  return { pedal, log, dev };
}

const corrupt = (chunk, i, value) => {
  const c = Uint8Array.from(chunk);
  c[i] = value;
  return c;
};

test("connect: handshake sends identity query then enter-editor-mode", async () => {
  const { pedal, log, dev } = setup();
  await dev.connect();
  assert.deepEqual(pedal.sent.map((m) => m[9]), [0x04, 0x12]);
  assert.ok(log.lines.some((l) => l.includes("answered the identity query")));
});

test("connect: a silent pedal only warns (reads don't need the handshake)", async () => {
  const { log, dev } = setup({ answerIdentity: false });
  await dev.connect();
  assert.ok(log.lines.some((l) => l.includes("WARN") && l.includes("No identity reply")));
});

test("readDump: clean read on the first attempt", async () => {
  const dump = dumpWithName("Clean");
  const { dev } = setup({ dumps: new Map([[7, dump]]) });
  const r = await dev.readDump(7);
  assert.deepEqual(r.decoded, dump);
  assert.equal(r.attempt, 1);
});

test("readDump: chunks arriving out of order are reassembled", async () => {
  const { dev } = setup({ faults: (s, n, chunks) => [...chunks].reverse() });
  assert.deepEqual((await dev.readDump(0)).decoded, baseDump());
});

test("readDump: a duplicated chunk is ignored, not double-counted", async () => {
  const { dev, log } = setup({ faults: (s, n, chunks) => [chunks[0], ...chunks] });
  assert.deepEqual((await dev.readDump(0)).decoded, baseDump());
  assert.ok(log.lines.some((l) => l.includes("duplicate offset")));
});

test("readDump: a missing chunk times out, then the re-read succeeds", async () => {
  const { dev, log } = setup({ faults: (s, n, chunks) => (n === 1 ? chunks.slice(0, 6) : chunks) });
  const r = await dev.readDump(3);
  assert.equal(r.attempt, 2);
  assert.ok(log.lines.some((l) => l.includes("WARN") && l.includes("timed out with 6 of 7")));
});

test("readDump: a non-nibble byte fails the sanity check and triggers a re-read", async () => {
  const { dev, log } = setup({ faults: (s, n, chunks) => (n === 1 ? [corrupt(chunks[2], 40, 0x3c), ...chunks.filter((_, i) => i !== 2)] : chunks) });
  const r = await dev.readDump(3);
  assert.equal(r.attempt, 2);
  assert.deepEqual(r.decoded, baseDump());
  assert.ok(log.lines.some((l) => l.includes("non-nibble byte 0x3c")));
});

test("readDump: gives up with ReadError after every attempt fails", async () => {
  const { dev, pedal } = setup({ faults: () => [] }, { attempts: 3 });
  await assert.rejects(dev.readDump(9), (e) => e instanceof ReadError && e.slot === 9 && /timed out/.test(e.reason));
  assert.equal(pedal.reads.get(9), 3);
});

test("readDump: unrelated and unsolicited messages don't confuse a read", async () => {
  const { dev, pedal } = setup({
    faults: (s, n, chunks) => [Uint8Array.from([0xfe]), Uint8Array.from([0xf0, 0x7e, 0x00, 0xf7]), ...chunks],
  });
  pedal.input.onmidimessage({ data: Uint8Array.from([0xc0, 0x05]) }); // before any request
  assert.deepEqual((await dev.readDump(0)).decoded, baseDump());
});

test("readDump: a SysEx without F7 is logged as a warning", async () => {
  const { dev, log, pedal } = setup();
  pedal.input.onmidimessage({ data: Uint8Array.from([0xf0, 0x21, 0x25]) });
  assert.ok(log.lines.some((l) => l.includes("without a closing F7")));
  await dev.readDump(0);
});

test("checkDump: flags odd payloads and short dumps", () => {
  const chunks = FakePedal.dumpChunks(baseDump());
  assert.deepEqual(checkDump(chunks, assembleChunks(chunks)), []);
  const odd = chunks.map((c, i) => (i === 6 ? Uint8Array.from([...c.subarray(0, c.length - 2), 0xf7]) : c));
  assert.match(checkDump(odd, assembleChunks(odd)).join(), /odd payload length/);
  const short = FakePedal.dumpChunks(baseDump().slice(0, 500));
  assert.match(checkDump(short, assembleChunks(short)).join(), /only 500 bytes/);
});

test("findGp200Ports: matches the CLI's auto-detect rule", () => {
  const ports = [{ name: "GP-200" }, { name: "Microsoft GS Wavetable Synth" }, { name: "gp200 MIDI 1" }, { name: "GP-100" }];
  assert.deepEqual(findGp200Ports(ports).map((p) => p.name), ["GP-200", "gp200 MIDI 1"]);
});

test("readOnce: one attempt with its own timeout, no retry and no warning", async () => {
  const { dev, pedal, log } = setup({ faults: () => [] });
  const r = await dev.readOnce(4, 10);
  assert.equal(r.ok, false);
  assert.equal(r.got, 0);
  assert.equal(pedal.reads.get(4), 1);
  assert.ok(!log.lines.some((l) => l.includes("WARN")));
});

const NO_DELAY = { chunkGapMs: 0, settleMs: 0, presetChangeMs: 0 };
const kinds = (pedal) => pedal.sent.map((m) => (m[8] === 0x12 && m[9] === 0x20 ? "U" : m[9] === 0x10 ? "R" : m[9] === 0x08 ? "P" : "?"));

test("restore timing: the CLI's pacing (a faster one changed bytes after verify, DEV_JOURNAL.md 2026-10-01)", () => {
  assert.deepEqual(WRITE_TIMING, { chunkGapMs: 40, settleMs: 1000, presetChangeMs: 300 });
  assert.equal(plannedWriteMs(WRITE_TIMING), 1580);
});

test("writeSlot: upload, preset change, then the read-back (the CLI's order)", async () => {
  const { dev, pedal } = setup({}, { timing: NO_DELAY });
  await dev.connect();
  pedal.sent.length = 0;
  const r = await dev.writeSlot(3, exportPrst(dumpWithName("Ordered"), skeletonBytes()), skeletonBytes());
  assert.equal(r.ok, true);
  assert.deepEqual(kinds(pedal), ["U", "U", "U", "U", "U", "U", "U", "P", "R"]);
  assert.equal(pedal.activeSlot, 3);
});

test("writeSlot: the pauses are really taken, settle before the preset change", async () => {
  const { dev, pedal } = setup({}, { timing: { chunkGapMs: 2, settleMs: 30, presetChangeMs: 5 } });
  await dev.connect();
  let presetAt = 0;
  const send = pedal.output.send;
  pedal.output.send = (m) => { if (m[9] === 0x08) presetAt = performance.now(); send(m); };
  const t0 = performance.now();
  const r = await dev.writeSlot(3, exportPrst(dumpWithName("Paced"), skeletonBytes()), skeletonBytes());
  assert.equal(r.ok, true);
  assert.ok(presetAt - t0 >= 7 * 2 + 30 - 2, `preset change after ${presetAt - t0} ms`);
  assert.ok(r.totalMs >= 7 * 2 + 30 + 5 - 2);
});

test("writeSlot: a write that never lands fails after one confirming re-read, and still selects the slot", async () => {
  const { dev, pedal } = setup({}, { timing: NO_DELAY }); // no connect(): uploads are discarded
  const r = await dev.writeSlot(5, exportPrst(dumpWithName("Never"), skeletonBytes()), skeletonBytes());
  assert.equal(r.ok, false);
  assert.equal(r.recheckedAfterMismatch, true);
  assert.equal(pedal.reads.get(5), 2);
  assert.equal(pedal.activeSlot, 5);
});

test("slowWriteWarning: quiet at normal speed, warns when throttled", () => {
  assert.equal(slowWriteWarning("64A", { totalMs: 1900, plannedMs: 1580 }), null);
  assert.equal(slowWriteWarning("64A", { totalMs: 400, plannedMs: 0 }), null, "tiny plans need 500 ms of slack");
  assert.match(slowWriteWarning("64A", { totalMs: 9800, plannedMs: 1580 }, true), /took 9\.8 s, planned 1\.6 s \(the page was hidden/);
  assert.equal(slowWriteWarning("64A", { totalMs: 1200, plannedMs: 0 }), "64A: the write took 1.2 s");
  assert.doesNotMatch(slowWriteWarning("64A", { totalMs: 9800, plannedMs: 1580 }, false), /hidden/);
});

test("sendUpload: a chunk gap of 0 sends all 7 chunks at once; any gap paces them", async () => {
  const prst = exportPrst(dumpWithName("Burst"), skeletonBytes());
  const uploads = (pedal) => pedal.sent.filter((m) => m[8] === 0x12 && m[9] === 0x20).length;
  const fast = setup({}, { timing: { chunkGapMs: 0, settleMs: 0, presetChangeMs: 0 } });
  const done = fast.dev.sendUpload(3, prst);
  assert.equal(uploads(fast.pedal), 7, "all sent before the first await returns");
  await done;
  const paced = setup({}, { timing: { chunkGapMs: 5, settleMs: 0, presetChangeMs: 0 } });
  const pending = paced.dev.sendUpload(3, prst);
  assert.equal(uploads(paced.pedal), 1, "only the first chunk goes out before the first pause");
  await pending;
  assert.equal(uploads(paced.pedal), 7);
});
