// The write path: CLI parity for the exact upload bytes, planning, and
// write + verify against the fake pedal (including ways a write can fail).

import assert from "node:assert/strict";
import { test } from "node:test";
import { FAST_WRITE_TIMING, GP200 } from "../src/core/device.js";
import { readSlots } from "../src/core/export.js";
import { Logger } from "../src/core/log.js";
import { DEAD_BYTE_FILE_OFFSETS, diffPrstContent, exportPrst } from "../src/core/prst.js";
import { skeletonBytes } from "../src/core/skeleton.js";
import { buildPresetChange, buildUploadChunks, buildUploadImage, toHex } from "../src/core/sysex.js";
import {
  expandSources,
  orderEntries,
  parseLeadingSlotLabel,
  planUpload,
  planWarnings,
  writeSlots,
} from "../src/core/upload.js";
import { createZip } from "../src/core/zip.js";
import { baseDump, dumpWithName, fixtureBytes, goldenManifest } from "./helpers/fixtures.js";
import { FakePedal } from "./helpers/fake-pedal.js";

const golden = goldenManifest();
// Short read-back limits keep the failure tests fast.
const NO_DELAY = { chunkGapMs: 0, settleMs: 0, presetChangeMs: 0 };
const prstNamed = (name) => exportPrst(dumpWithName(name), skeletonBytes());

function setup(pedalOpts = {}) {
  const pedal = new FakePedal({ defaultDump: baseDump(), ...pedalOpts });
  const log = new Logger();
  const dev = new GP200({ input: pedal.input, output: pedal.output, log, timeoutMs: 50, timing: NO_DELAY });
  return { pedal, log, dev };
}

// ---- Parity with the CLI (tools/make_golden.py) ---------------------------

for (const u of golden.uploads) {
  test(`golden upload: ${u.case} -> slot ${u.slot} matches the CLI's SysEx exactly`, () => {
    const chunks = buildUploadChunks(buildUploadImage(fixtureBytes(`golden/${u.case}.prst`), u.slot));
    assert.deepEqual(chunks.map((c) => c.length), u.chunk_lengths);
    const joined = Uint8Array.from(chunks.flatMap((c) => [...c]));
    assert.deepEqual(joined, fixtureBytes(`golden/upload_${u.case}_${u.slot}.bin`));
    assert.equal(toHex(buildPresetChange(u.slot)).replace(/ /g, ""), u.preset_change_hex);
  });
}

test("golden verify: the same offsets count as mismatches as in the CLI", () => {
  const { probe_offsets, flagged_default, flagged_ignoring_dead } = golden.verify_diff;
  const expected = fixtureBytes("golden/plain.prst");
  const actual = Uint8Array.from(expected);
  for (const off of probe_offsets) actual[off] ^= 0x5a;
  assert.deepEqual(diffPrstContent(expected, actual).map((m) => m.off), flagged_default);
  assert.deepEqual(diffPrstContent(expected, actual, DEAD_BYTE_FILE_OFFSETS).map((m) => m.off), flagged_ignoring_dead);
});

test("golden zip order: slot labels, then the alphabetical fallback", () => {
  const z = golden.zip_order;
  for (const [name, slot] of Object.entries(z.labels)) assert.equal(parseLeadingSlotLabel(name), slot, name);
  const mk = (names) => names.map((name) => ({ name, data: new Uint8Array(0) }));
  assert.deepEqual(orderEntries(mk(z.labelled_in)).ordered.map((e) => e.name), z.labelled_out);
  assert.deepEqual(orderEntries(mk(z.mixed_in)).ordered.map((e) => e.name), z.mixed_out);
});

// ---- Planning -------------------------------------------------------------

test("expandSources: one zip is unpacked; mixing or two zips is refused", async () => {
  const zip = createZip([
    { name: "64B_Two.prst", data: prstNamed("Two") },
    { name: "readme.txt", data: new Uint8Array(3) },
    { name: "64A_One.prst", data: prstNamed("One") },
  ]);
  const { entries, notes } = await expandSources([{ name: "backup.zip", data: zip }]);
  assert.deepEqual(entries.map((e) => e.name), ["64B_Two.prst", "64A_One.prst"]);
  assert.match(notes.join(), /skipping readme\.txt/);
  await assert.rejects(expandSources([{ name: "a.zip", data: zip }, { name: "b.prst", data: new Uint8Array(0) }]), /not both/);
  await assert.rejects(expandSources([{ name: "a.zip", data: zip }, { name: "b.zip", data: zip }]), /one \.zip/);
  const empty = createZip([{ name: "x.txt", data: new Uint8Array(1) }]);
  await assert.rejects(expandSources([{ name: "e.zip", data: empty }]), /no \.prst files/);
});

test("planUpload: consecutive slots, invalid files keep their slot, overflow stops at 64D", () => {
  const entries = [
    { name: "a.prst", data: prstNamed("A") },
    { name: "bad.prst", data: new Uint8Array(10) },
    { name: "c.prst", data: prstNamed("C") },
    { name: "d.prst", data: prstNamed("D") },
  ];
  const plan = planUpload(entries, 253); // 64B
  assert.deepEqual(plan.items.map((i) => [i.label, i.patchName]), [["64B", "A"], ["64D", "C"]]);
  assert.deepEqual(plan.skipped.map((s) => s.label), ["64C"]);
  assert.deepEqual(plan.overflow, ["d.prst"]);
  assert.match(planWarnings(plan).join(), /bad\.prst -> 64C: not a valid \.prst file.*d\.prst/s);
});

test("planUpload: flags User-IR / NAM references before writing", () => {
  const plan = planUpload([{ name: "ir.prst", data: fixtureBytes("golden/ir_nam.prst") }], 252);
  assert.deepEqual(plan.items[0].irNam, ["User-IR slot 3", "SnapTone (NAM) slot 1 (amp)", "SnapTone (NAM) slot 2 (dist)"]);
  assert.match(planWarnings(plan).join(), /64A: User-IR slot 3/);
});

// ---- Writing against the fake pedal ---------------------------------------

test("write + verify: a patch lands, verifies, and the pedal switches to it", async () => {
  const { pedal, log, dev } = setup();
  await dev.connect();
  const data = prstNamed("Scratch One");
  const plan = planUpload([{ name: "one.prst", data }], 252);
  const { results, failed } = await writeSlots(dev, plan.items, { skeleton: skeletonBytes(), log, betweenSlotsMs: 0 });
  assert.equal(failed.length, 0);
  assert.equal(results[0].deviceName, "Scratch One");
  assert.equal(pedal.activeSlot, 252);
  assert.equal(pedal.dumpOf(252)[0x90 - 0x28], 252, "device recomputed the slot mirror");
  assert.ok(log.lines.some((l) => l.includes("64A: verified")));
});

test("write without the handshake is discarded by the pedal, and verify catches it", async () => {
  const { log, dev } = setup(); // no connect(): no enter-editor-mode
  const plan = planUpload([{ name: "one.prst", data: prstNamed("Never Lands") }], 252);
  const { failed } = await writeSlots(dev, plan.items, { skeleton: skeletonBytes(), log, betweenSlotsMs: 0 });
  assert.equal(failed.length, 1);
  assert.ok(failed[0].mismatches.some((m) => m.off >= 0x44 && m.off < 0x54), "name mismatch reported");
  assert.ok(log.lines.some((l) => l.includes("64A: WRITE NOT VERIFIED")));
});

test("a corrupted upload chunk is reported as a failed write, with the offset", async () => {
  const { log, dev } = setup({
    writeFaults: (slot, n, chunks) => chunks.map((c, i) => {
      if (i !== 3) return c;
      const x = Uint8Array.from(c);
      x[100] ^= 0x01; // one nibble wrong in the 4th chunk
      return x;
    }),
  });
  await dev.connect();
  const plan = planUpload([{ name: "one.prst", data: prstNamed("Glitchy") }], 253);
  const { failed } = await writeSlots(dev, plan.items, { skeleton: skeletonBytes(), log, betweenSlotsMs: 0 });
  assert.equal(failed.length, 1);
  assert.equal(failed[0].mismatches.length, 1);
  assert.equal(failed[0].recheckedAfterMismatch, true);
});

test("read noise on the read-back is re-checked, not reported as a failed write", async () => {
  const { log, dev } = setup({
    faults: (slot, n, chunks) => {
      if (n !== 1) return chunks; // only the first read-back is noisy
      const c = Uint8Array.from(chunks[1]);
      c[60] ^= 0x03; // a valid-looking nibble, so it passes the sanity checks
      return [chunks[0], c, ...chunks.slice(2)];
    },
  });
  await dev.connect();
  const plan = planUpload([{ name: "one.prst", data: prstNamed("Noisy Read") }], 254);
  const { failed, results } = await writeSlots(dev, plan.items, { skeleton: skeletonBytes(), log, betweenSlotsMs: 0 });
  assert.equal(failed.length, 0);
  assert.equal(results[0].recheckedAfterMismatch, true);
  assert.ok(log.lines.some((l) => l.includes("read noise, not a failed write")));
  assert.ok(log.lines.some((l) => l.includes("1 verified only after a confirming re-read (64C)")));
});

test("cancel stops between patches, never mid-patch", async () => {
  const { log, dev } = setup();
  await dev.connect();
  const plan = planUpload(["A", "B", "C"].map((n) => ({ name: `${n}.prst`, data: prstNamed(n) })), 252);
  let done = 0;
  const r = await writeSlots(dev, plan.items, {
    skeleton: skeletonBytes(), log, betweenSlotsMs: 0, onProgress: () => done++, isCancelled: () => done >= 1,
  });
  assert.equal(r.results.length, 1);
  assert.equal(r.cancelled, true);
});

test("round trip on the fake pedal: export -> write elsewhere -> export matches", async () => {
  const dumps = new Map([[0, dumpWithName("Zero")], [1, dumpWithName("One")], [2, dumpWithName("Two")]]);
  const { log, dev } = setup({ dumps });
  await dev.connect();
  const skeleton = skeletonBytes();
  const before = await readSlots(dev, [0, 1, 2], { skeleton, log });
  const { ordered } = orderEntries(before.entries.map((e) => ({ name: e.fileName, data: e.data })));
  const w = await writeSlots(dev, planUpload(ordered, 252).items, { skeleton, log, betweenSlotsMs: 0 });
  assert.equal(w.failed.length, 0);
  const after = await readSlots(dev, [252, 253, 254], { skeleton, log });
  assert.deepEqual(after.entries.map((e) => e.name), ["Zero", "One", "Two"]);
  for (let i = 0; i < 3; i++) {
    // Identical except the slot-mirror bytes, which name the new slot.
    const diffs = diffPrstContent(before.entries[i].data, after.entries[i].data);
    assert.deepEqual(diffs, []);
  }
});

// ---- Fast pacing in a restore (DEV_JOURNAL.md 2026-10-01) -----------------

test("fast restore: no pause between patches, the pacing logged, managed-byte changes reported, not failed", async () => {
  const { pedal, log, dev } = setup({ storeAs: { off: 0x456, value: 0 } });
  dev.timing = { ...FAST_WRITE_TIMING, readBackTimeoutMs: 30, readBackLimitMs: 120 };
  await dev.connect();
  const withTwo = (name) => {
    const d = dumpWithName(name);
    d[0x456 - 0x28] = 2;
    return exportPrst(d, skeletonBytes());
  };
  const files = [["1_a.prst", withTwo("Has Two")], ["2_b.prst", prstNamed("Plain")], ["3_c.prst", withTwo("Also Two")]];
  const plan = planUpload(files.map(([name, data]) => ({ name, data })), 252);
  const t0 = performance.now();
  const { results, failed } = await writeSlots(dev, plan.items, { skeleton: skeletonBytes(), log });
  assert.ok(performance.now() - t0 < 250, "betweenSlotsMs comes from the fast pacing (0), not the CLI's 300");
  assert.equal(failed.length, 0);
  assert.deepEqual(results.map((r) => r.managed.length), [1, 0, 1]);
  assert.equal(pedal.activeSlot, 254);
  assert.ok(log.lines.some((l) => l.includes("Restore pacing: fast (chunk gap 0 ms, settle 0 ms, after preset change 0 ms, between patches 0 ms; read back until it matches")));
  assert.ok(log.lines.some((l) => l.includes('64A: verified, now reads "Has Two"; pedal-managed byte(s) differ (not a setting): 0x456 2->0')));
  assert.ok(log.lines.some((l) => l.includes("2 read back with pedal-managed byte(s) changed, not a setting (64A, 64C)")));
});

test("the CLI's pacing is still the default: 300 ms between patches, logged", async () => {
  const { log, dev } = setup();
  await dev.connect();
  const plan = planUpload([{ name: "1.prst", data: prstNamed("One") }, { name: "2.prst", data: prstNamed("Two") }], 252);
  const t0 = performance.now();
  await writeSlots(dev, plan.items, { skeleton: skeletonBytes(), log });
  assert.ok(performance.now() - t0 >= 290);
  assert.ok(log.lines.some((l) => l.includes("Restore pacing: the CLI's (") && l.includes("between patches 300 ms)")));
});
