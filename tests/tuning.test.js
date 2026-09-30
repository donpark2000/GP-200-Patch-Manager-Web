// The developer write-timing test (DEV_JOURNAL.md T1/T2) against the fake
// pedal, including a simulated flash-commit delay and writes that never land.

import assert from "node:assert/strict";
import { test } from "node:test";
import { GP200 } from "../src/core/device.js";
import { Logger } from "../src/core/log.js";
import { exportPrst } from "../src/core/prst.js";
import { skeletonBytes } from "../src/core/skeleton.js";
import { labelToSlot } from "../src/core/slots.js";
import { checkTuningSets, runTuning, sameContent, SCRATCH_SLOTS, summarizeTuning, tuningCsv } from "../src/core/tuning.js";
import { baseDump, dumpWithName } from "./helpers/fixtures.js";
import { FakePedal } from "./helpers/fake-pedal.js";

const NO_DELAY = { chunkGapMs: 0, settleMs: 0, presetChangeMs: 0 };
const entry = (name) => ({ name: `${name}.prst`, data: exportPrst(dumpWithName(name), skeletonBytes()) });
const setX = [entry("X-A"), entry("X-B")];
const setY = [entry("Y-A"), entry("Y-B")];

async function setup(pedalOpts = {}, { connect = true } = {}) {
  const pedal = new FakePedal({ defaultDump: baseDump(), ...pedalOpts });
  const log = new Logger();
  const dev = new GP200({ input: pedal.input, output: pedal.output, log, timeoutMs: 50, timing: NO_DELAY });
  if (connect) await dev.connect();
  return { pedal, log, dev };
}

const run = (dev, log, opts = {}) =>
  runTuning(dev, { setX, setY, cycles: 3, mode: "fixed", timing: NO_DELAY, betweenSlotsMs: 0, skeleton: skeletonBytes(), log, ...opts });

const holds = (pedal, slot, e) => sameContent(exportPrst(pedal.dumpOf(slot), skeletonBytes()), e.data);

test("scratch slots are 64A-64D and nothing else", () => {
  assert.deepEqual(SCRATCH_SLOTS, ["64A", "64B", "64C", "64D"].map(labelToSlot));
});

test("checkTuningSets: accepts different patches, rejects unusable sets", () => {
  assert.deepEqual(checkTuningSets(setX, setY), []);
  assert.match(checkTuningSets([], setY).join(), /both set X and set Y/);
  assert.match(checkTuningSets(setX, setY.slice(0, 1)).join(), /must match/);
  const five = [1, 2, 3, 4, 5].map((i) => entry(`P${i}`));
  assert.match(checkTuningSets(five, five).join(), /At most 4/);
  assert.match(checkTuningSets([{ name: "junk.prst", data: new Uint8Array(10) }], [setY[0]]).join(), /not a valid \.prst/);
  // Same content under different file names: a write couldn't be seen.
  assert.match(checkTuningSets([setX[0]], [{ ...setX[0], name: "copy.prst" }]).join(), /same patch/);
});

test("fixed mode: every write changes the slot and verifies; slots alternate X, Y, X", async () => {
  const { pedal, log, dev } = await setup();
  const { rows, summary } = await run(dev, log);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((r) => `${r.label}${r.set}`), ["64AX", "64BX", "64AY", "64BY", "64AX", "64BX"]);
  assert.ok(rows.every((r) => r.verified && !r.rechecked));
  assert.equal(summary.notVerified, 0);
  assert.ok(holds(pedal, SCRATCH_SLOTS[0], setX[0]) && holds(pedal, SCRATCH_SLOTS[1], setX[1]));
  assert.ok(!pedal.writes.has(SCRATCH_SLOTS[2]), "only as many slots as patches per set");
  assert.ok(log.lines.some((l) => l.includes("Timing test result: 6 write(s), 0 NOT verified")));
});

test("fixed mode: a slot that already holds X starts with Y, so the first write still changes it", async () => {
  const dumps = new Map([[SCRATCH_SLOTS[0], dumpWithName("X-A")]]);
  const { log, dev } = await setup({ dumps });
  const { rows } = await run(dev, log, { cycles: 1 });
  assert.deepEqual(rows.map((r) => r.set), ["Y", "X"]);
});

test("poll mode: reads during a slow commit get the old patch, then the new one", async () => {
  const { log, dev } = await setup({ commitMs: 40 });
  const { rows, summary } = await run(dev, log, { mode: "poll", cycles: 2, pollTimeoutMs: 50, pollMaxMs: 1000 });
  assert.ok(rows.every((r) => r.verified));
  assert.ok(rows.every((r) => r.firstReply === "old" && r.newAtMs >= 30 && r.polls >= 2), JSON.stringify(rows.map((r) => r.pollTrace)));
  assert.equal(summary.firstReply.old, 4);
  assert.equal(summary.neverNew, 0);
});

test("poll mode: a pedal that ignores reads while committing shows up as timed-out polls", async () => {
  const { pedal, log, dev } = await setup({ commitMs: 60, readsDuringCommit: "ignore" });
  const { rows } = await run(dev, log, { mode: "poll", cycles: 1, pollTimeoutMs: 25, pollMaxMs: 1000 });
  assert.ok(pedal.readsIgnored > 0);
  assert.ok(rows.every((r) => r.verified && r.firstReply === "new" && /:0\/7/.test(r.pollTrace)), JSON.stringify(rows.map((r) => r.pollTrace)));
});

test("poll mode: a write that never lands hits the poll limit and fails the verify", async () => {
  const { log, dev } = await setup({}, { connect: false }); // no editor mode: uploads discarded
  const { rows, summary } = await run(dev, log, { mode: "poll", cycles: 1, pollTimeoutMs: 20, pollMaxMs: 60 });
  assert.ok(rows.every((r) => !r.verified && r.newAtMs === null && r.firstReply === "old"));
  assert.equal(summary.notVerified, 2);
  assert.equal(summary.neverNew, 2);
  assert.ok(log.lines.some((l) => l.includes("ERROR") && l.includes("new patch never seen")));
});

test("runTuning: unusable sets are refused before anything is written", async () => {
  const { pedal, log, dev } = await setup();
  await assert.rejects(run(dev, log, { setY: setX }), /same patch/);
  assert.equal(pedal.writes.size, 0);
});

test("runTuning: stops between writes when cancelled", async () => {
  const { log, dev } = await setup();
  let n = 0;
  const { rows, cancelled } = await run(dev, log, { onProgress: () => n++, isCancelled: () => n >= 3 });
  assert.equal(rows.length, 3);
  assert.ok(cancelled);
});

test("summary and CSV: medians, first-reply counts, quoting", () => {
  const rows = [
    { mode: "poll", verified: true, rechecked: false, hidden: false, writeMs: 100, totalMs: 300, firstReply: "old", firstReplyMs: 20, newAtMs: 80 },
    { mode: "poll", verified: false, rechecked: true, hidden: true, writeMs: 300, totalMs: 900, firstReply: "none", firstReplyMs: null, newAtMs: null, reason: 'a "b", c' },
  ];
  const s = summarizeTuning(rows);
  assert.deepEqual([s.notVerified, s.rechecked, s.hidden, s.neverNew], [1, 1, 1, 1]);
  assert.deepEqual(s.writeMs, { min: 100, median: 200, max: 300 });
  assert.deepEqual(s.firstReply, { old: 1, none: 1 });
  const csv = tuningCsv(rows).trim().split("\n");
  assert.equal(csv.length, 3);
  assert.ok(csv[2].endsWith(`"a ""b"", c"`));
  assert.equal(summarizeTuning([]).writeMs, null);
});
