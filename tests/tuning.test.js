// The developer write-timing test (DEV_JOURNAL.md T1/T2) against the fake
// pedal, including a simulated flash-commit delay and writes that never land.

import assert from "node:assert/strict";
import { test } from "node:test";
import { GP200 } from "../src/core/device.js";
import { Logger } from "../src/core/log.js";
import { exportPrst } from "../src/core/prst.js";
import { skeletonBytes } from "../src/core/skeleton.js";
import { labelToSlot } from "../src/core/slots.js";
import { checkTuningSets, formatDiffs, runTuning, sameContent, SCRATCH_SLOTS, summarizeTuning, tuningCsv } from "../src/core/tuning.js";
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
  const { rows, summary } = await run(dev, log, { mode: "poll", cycles: 1, pollTimeoutMs: 20, pollMaxMs: 60, lateSettleMs: 0 });
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
  assert.ok(csv[0].endsWith(",reason,late,lateWhen,lateDiff,otherDiff,otherDiffLast,verifyBeforeSwitch,lateMode,managedDiff"));
  assert.ok(csv[2].includes(`,"a ""b"", c",`));
  assert.equal(summarizeTuning([]).writeMs, null);
});

// ---- Late check (the fault the 2026-10-01 full restore found) -------------

const FRAGILE = 0x456;
const entry2 = (name) => {
  const d = dumpWithName(name);
  d[FRAGILE - 0x28] = 2; // like Rock Soul or Radio Cat: a 2 the fault turns into 0
  return { name: `${name}.prst`, data: exportPrst(d, skeletonBytes()) };
};
const fragX = [entry2("FX-A"), entry2("FX-B")];
const fragY = [entry2("FY-A"), entry2("FY-B")];

test("late check: catches a byte the pedal changes after the verify passed", async () => {
  const { pedal, log, dev } = await setup({ fragile: { off: FRAGILE, windowMs: 40 } });
  const { rows, summary } = await run(dev, log, { setX: fragX, setY: fragY, cycles: 3 });
  assert.ok(rows.every((r) => r.verified), "every immediate verify passed");
  assert.ok(pedal.fragileHits > 0);
  assert.ok(summary.lateChanged.length > 0 && summary.lateChangedAfterVerify === summary.lateChanged.length);
  assert.ok(rows.some((r) => r.late === "CHANGED" && r.lateDiff === "0x456:2->0"), JSON.stringify(rows.map((r) => r.late)));
  assert.ok(log.lines.some((l) => l.includes("ERROR") && l.includes("CHANGED since it was written (its verify had passed)")));
  assert.ok(log.lines.some((l) => /late check: \d+ of 6 write\(s\) re-read after moving on; \d+ CHANGED/.test(l)));
});

test("late check: with pauses longer than the fault window, nothing changes", async () => {
  const { pedal, log, dev } = await setup({ fragile: { off: FRAGILE, windowMs: 40 } });
  const { rows, summary } = await run(dev, log, {
    setX: fragX, setY: fragY, cycles: 3, timing: { ...NO_DELAY, presetChangeMs: 60 }, betweenSlotsMs: 0,
  });
  assert.equal(pedal.fragileHits, 0);
  assert.equal(summary.lateChanged.length, 0);
  assert.equal(summary.lateChecked, rows.length, "before-overwrite plus end-of-run covers every write");
  assert.ok(rows.every((r) => r.late === "ok"));
});

test("late check: the end-of-run check alone still covers each slot's last write", async () => {
  const { log, dev } = await setup({ fragile: { off: FRAGILE, windowMs: 40 } });
  const { rows, summary } = await run(dev, log, { setX: fragX, setY: fragY, cycles: 2, late: "end", lateSettleMs: 0 });
  assert.deepEqual(rows.map((r) => r.lateWhen), ["", "", "end of run", "end of run"]);
  assert.equal(summary.lateChecked, 2);
  assert.ok(summary.lateChanged.length >= 1, "64A's last write was disturbed by the upload to 64B");
});

test("late check: the final switch waits the between-writes pause, so it doesn't cause the fault itself", async () => {
  const { pedal, log, dev } = await setup({ fragile: { off: FRAGILE, windowMs: 40 } });
  await run(dev, log, {
    setX: fragX.slice(0, 1), setY: fragY.slice(0, 1), cycles: 1, timing: NO_DELAY, betweenSlotsMs: 60, lateSettleMs: 0,
  });
  assert.equal(pedal.fragileHits, 0);
  assert.equal(pedal.activeSlot, SCRATCH_SLOTS[1], "with one slot in use it switches to the next scratch slot");
});

// ---- "Other" poll replies (Love Yourself, runs B and C of 2026-10-01) ------

test("poll mode: \"other\" replies record where they differed from the new patch", async () => {
  const { log, dev } = await setup({ unloadedReads: { off: FRAGILE, value: 0 } });
  const { rows, summary } = await run(dev, log, { setX: fragX, setY: fragY, mode: "poll", cycles: 1, pollTimeoutMs: 20, pollMaxMs: 60, lateSettleMs: 0 });
  assert.ok(rows.every((r) => r.verified), "the read after the preset change matches");
  assert.ok(rows.every((r) => r.firstReply === "other" && r.newAtMs === null && r.polls >= 2), JSON.stringify(rows.map((r) => r.pollTrace)));
  assert.ok(rows.every((r) => r.otherDiff === "0x456:2->0" && r.otherDiffLast === ""), JSON.stringify(rows.map((r) => r.otherDiff)));
  assert.equal(summary.neverNew, 2);
  assert.ok(log.lines.some((l) => l.includes('"other" replies differed from the new patch at 0x456:2->0 [')));
  assert.ok(tuningCsv(rows).split("\n")[1].endsWith(",0x456:2->0,,false,overwrite,"));
});

test("poll mode: no \"other\" replies, no otherDiff; long diffs are capped", async () => {
  const { log, dev } = await setup({ commitMs: 30 });
  const { rows } = await run(dev, log, { mode: "poll", cycles: 1, pollTimeoutMs: 50, pollMaxMs: 1000, lateSettleMs: 0 });
  assert.ok(rows.every((r) => r.otherDiff === "" && r.otherDiffLast === ""));
  assert.ok(!log.lines.some((l) => l.includes('"other" replies')));
  const many = Array.from({ length: 25 }, (_, i) => ({ off: 0x100 + i, expected: 1, actual: 0 }));
  assert.equal(formatDiffs(many, 20).split(" ").length, 22); // 20 entries + "(+5" + "more)"
  assert.ok(formatDiffs(many, 20).endsWith("0x113:1->0 (+5 more)"));
  assert.equal(formatDiffs([]), "");
});

// ---- Verify before the switch (the withdrawn fast restore's order) --------

const isRead = (m) => m[8] === 0x11 && m[9] === 0x10;
const isUpload = (m) => m[8] === 0x12 && m[9] === 0x20;
const isSwitch = (m) => m[8] === 0x12 && m[9] === 0x08;

test("verify before the switch: read-back, then preset change, then the next upload with nothing between", async () => {
  const { pedal, log, dev } = await setup();
  const start = pedal.sent.length;
  const { rows } = await run(dev, log, { cycles: 2, verifyBeforeSwitch: true, late: "end", lateSettleMs: 0 });
  assert.ok(rows.every((r) => r.verified && r.verifyBeforeSwitch === true));
  const sent = pedal.sent.slice(start);
  const switches = sent.map((m, i) => (isSwitch(m) ? i : -1)).filter((i) => i >= 0);
  assert.equal(switches.length, 4 + 1, "one per write plus the end-of-run switch");
  for (const i of switches.slice(0, 3)) assert.ok(isUpload(sent[i + 1]), `message after switch ${i} is an upload`);
  for (const i of switches.slice(0, 4)) assert.ok(isRead(sent[i - 1]), `message before switch ${i} is the verify read`);
  assert.ok(log.lines.some((l) => l.includes("verify BEFORE the preset change")));
  assert.ok(tuningCsv(rows).split("\n")[0].endsWith(",verifyBeforeSwitch,lateMode,managedDiff"));
});

test("default order: a verify read always sits between the switch and the next upload", async () => {
  const { pedal, log, dev } = await setup();
  const start = pedal.sent.length;
  await run(dev, log, { cycles: 2, late: "end", lateSettleMs: 0 });
  const sent = pedal.sent.slice(start);
  const switches = sent.map((m, i) => (isSwitch(m) ? i : -1)).filter((i) => i >= 0);
  for (const i of switches.slice(0, 3)) assert.ok(isRead(sent[i + 1]), `message after switch ${i} is a read`);
});

test("verify before the switch reproduces a fault that a read after the switch would prevent", async () => {
  const fragile = { off: FRAGILE, windowMs: 40, readEndsWindow: true };
  const opts = { setX: fragX, setY: fragY, cycles: 2, late: "end", lateSettleMs: 0 };
  const a = await setup({ fragile });
  const before = await run(a.dev, a.log, opts);
  assert.equal(a.pedal.fragileHits, 0, "default order: the verify read ends the window");
  assert.equal(before.summary.lateChanged.length, 0);
  const b = await setup({ fragile });
  const after = await run(b.dev, b.log, { ...opts, verifyBeforeSwitch: true });
  assert.ok(after.rows.every((r) => r.verified), "every immediate verify passed");
  assert.ok(b.pedal.fragileHits > 0);
  assert.ok(after.summary.lateChanged.length > 0 && after.summary.lateChangedAfterVerify === after.summary.lateChanged.length);
});

test("verify before the switch: a slot that reads a pedal-managed byte differently until selected passes, and it's recorded", async () => {
  const { log, dev } = await setup({ unloadedReads: { off: FRAGILE, value: 1 } });
  const { rows } = await run(dev, log, { setX: fragX, setY: fragY, cycles: 1, verifyBeforeSwitch: true, late: "end", lateSettleMs: 0 });
  assert.ok(rows.every((r) => r.verified && !r.rechecked && r.managedDiff === "0x456:2->1"), JSON.stringify(rows.map((r) => r.managedDiff)));
  assert.ok(log.lines.some((l) => l.includes("pedal-managed byte(s) at the verify: 0x456:2->1")));
  assert.ok(rows.every((r) => r.late === "ok"), "after the switch the slot reads as written");
});

test("verify before the switch: any other byte read differently still fails the verify, with the offset", async () => {
  const { log, dev } = await setup({ unloadedReads: { off: 0x100, value: 0x7f } });
  const { rows } = await run(dev, log, { setX: fragX, setY: fragY, cycles: 1, verifyBeforeSwitch: true, late: "end", lateSettleMs: 0 });
  assert.ok(rows.every((r) => !r.verified && r.rechecked && /^1 byte\(s\) differ from the file, the same in all 5 reads: 0x100:\d+->127$/.test(r.reason)), JSON.stringify(rows.map((r) => r.reason)));
});

test("verify before the switch with the late check before each overwrite on: warns", async () => {
  const { log, dev } = await setup();
  await run(dev, log, { cycles: 1, verifyBeforeSwitch: true, lateSettleMs: 0 });
  assert.ok(log.lines.some((l) => l.includes("WARN") && l.includes("Choose another late check to test the fast restore's order")));
});

// ---- Late check two writes later (B2-B4 checked only set Y's last writes) --

const frag4 = (p) => ["A", "B", "C", "D"].map((s) => entry2(`${p}-${s}`));
const fragX4 = frag4("FX");
const fragY4 = frag4("FY");
const slotOf = (m) => (m[25] << 4) | m[26];

test("two writes later: every write is late-checked, and the fast restore's fault is caught in every one", async () => {
  const fragile = { off: FRAGILE, windowMs: 40, readEndsWindow: true };
  const { pedal, log, dev } = await setup({ fragile });
  const { rows, summary } = await run(dev, log, {
    setX: fragX4, setY: fragY4, cycles: 2, verifyBeforeSwitch: true, late: "twoLater", lateSettleMs: 0,
  });
  assert.equal(rows.length, 8);
  assert.ok(rows.every((r) => r.verified), "every immediate verify passed");
  assert.deepEqual(rows.map((r) => r.lateWhen), [...Array(6).fill("two writes later"), "end of run", "end of run"]);
  assert.equal(summary.lateChecked, 8, "all 8 writes, both sets");
  assert.ok(pedal.fragileHits > 0);
  assert.equal(summary.lateChanged.length, 8, JSON.stringify(rows.map((r) => r.late)));
  assert.equal(summary.lateChangedAfterVerify, 8);
  assert.ok(rows.every((r) => r.lateDiff === "0x456:2->0" && r.lateMode === "twoLater"));
  assert.ok(log.lines.some((l) => l.includes("late check two writes later (after that write's verify) and at the end")));
  assert.ok(log.lines.some((l) => l.includes("then re-reading 64C (#7), 64D (#8)")), "the end only re-reads what wasn't checked");
});

test("two writes later: with the default order, the same fault model gives no changes (the verify read ends the window)", async () => {
  const { pedal, log, dev } = await setup({ fragile: { off: FRAGILE, windowMs: 40, readEndsWindow: true } });
  const { summary } = await run(dev, log, { setX: fragX4, setY: fragY4, cycles: 2, late: "twoLater", lateSettleMs: 0, betweenSlotsMs: 60 });
  assert.equal(pedal.fragileHits, 0);
  assert.equal(summary.lateChecked, 8);
  assert.equal(summary.lateChanged.length, 0);
});

test("two writes later: the check reads the slot two writes back, after the verify, and never right after a switch", async () => {
  for (const verifyBeforeSwitch of [true, false]) {
    const { pedal, log, dev } = await setup();
    const start = pedal.sent.length;
    const { rows } = await run(dev, log, { setX: fragX4.slice(0, 3), setY: fragY4.slice(0, 3), cycles: 2, verifyBeforeSwitch, late: "twoLater", lateSettleMs: 0 });
    const sent = pedal.sent.slice(start);
    const uploads = sent.map((m, i) => (isUpload(m) && !isUpload(sent[i - 1]) ? i : -1)).filter((i) => i >= 0);
    assert.equal(uploads.length, 6);
    const switches = sent.map((m, i) => (isSwitch(m) ? i : -1)).filter((i) => i >= 0);
    for (const i of switches.slice(0, 5)) {
      assert.ok(verifyBeforeSwitch ? isUpload(sent[i + 1]) : isRead(sent[i + 1]) && slotOf(sent[i + 1]) === slotOf(sent[i]),
        `${verifyBeforeSwitch ? "vfirst" : "default"}: what follows switch ${i}`);
    }
    // Writes 3-6: the message after the verify read is a read of the slot written two before.
    for (let w = 2; w < 6; w++) {
      const next = w < 5 ? uploads[w + 1] : sent.length;
      const reads = sent.slice(uploads[w], next).map((m, j) => [m, j]).filter(([m]) => isRead(m));
      const late = reads.find(([m]) => slotOf(m) === rows[w - 2].slot);
      assert.ok(late, `write ${w + 1} late-checks ${rows[w - 2].label}`);
      const seg = sent.slice(uploads[w], next);
      const sw = seg.findIndex(isSwitch);
      assert.ok(verifyBeforeSwitch ? late[1] < sw : late[1] > sw, "before the switch in vfirst order, after it otherwise");
    }
  }
});

test("two writes later: refused with fewer than 3 patches per set, before anything is written", async () => {
  const { pedal, log, dev } = await setup();
  await assert.rejects(run(dev, log, { late: "twoLater" }), /needs 3 or 4 patches per set/);
  await assert.rejects(run(dev, log, { late: "sometimes" }), /Unknown late-check mode/);
  assert.equal(pedal.writes.size, 0);
});

test("two writes later: the late read isn't counted in the write's own times", async () => {
  const { log, dev } = await setup();
  // Make every read of a slot other than the one being written (i.e. the
  // late check) take 150 ms; the writes themselves take a few ms.
  let writing = null;
  const { sendUpload, readDump } = dev;
  dev.sendUpload = (slot, ...rest) => ((writing = slot), sendUpload.call(dev, slot, ...rest));
  dev.readDump = async (slot) => {
    if (writing !== null && slot !== writing) await new Promise((r) => setTimeout(r, 150));
    return readDump.call(dev, slot);
  };
  const { rows } = await run(dev, log, { setX: fragX4, setY: fragY4, cycles: 2, late: "twoLater", lateSettleMs: 0 });
  assert.equal(rows.filter((r) => r.lateWhen === "two writes later").length, 6, "rows 3-8 each ran a slow late read");
  assert.ok(rows.every((r) => r.totalMs < 100), JSON.stringify(rows.map((r) => Math.round(r.totalMs))));
});
