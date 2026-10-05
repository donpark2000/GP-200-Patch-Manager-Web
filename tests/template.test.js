// The designed UI's core pieces: "12-A" labels, the patch-list read, and the
// Template screen (plan, re-check before writing, write) against the fake
// pedal, including the ways the plan must refuse to overwrite a patch.

import assert from "node:assert/strict";
import { test } from "node:test";
import { GP200 } from "../src/core/device.js";
import { readPatchList } from "../src/core/export.js";
import { Logger } from "../src/core/log.js";
import { exportPrst, extractNameField } from "../src/core/prst.js";
import { skeletonBytes } from "../src/core/skeleton.js";
import { labelToSlot, parseSlotRange, slotToDisplayLabel, slotToLabel } from "../src/core/slots.js";
import {
  EMPTY_PATCH_NAME,
  isEmptyPatchName,
  planTemplate,
  recheckTemplate,
  templateSummary,
  templateWarnings,
} from "../src/core/template.js";
import { writeSlots } from "../src/core/upload.js";
import { baseDump, dumpWithName, fixtureBytes } from "./helpers/fixtures.js";
import { FakePedal } from "./helpers/fake-pedal.js";

const NO_DELAY = { chunkGapMs: 0, settleMs: 0, presetChangeMs: 0 };
const prstNamed = (name) => exportPrst(dumpWithName(name), skeletonBytes());
const template = { name: "Template.prst", data: prstNamed("Template") };

function setup(pedalOpts = {}) {
  const pedal = new FakePedal({ defaultDump: baseDump(), ...pedalOpts });
  const log = new Logger();
  const dev = new GP200({ input: pedal.input, output: pedal.output, log, timeoutMs: 50, timing: NO_DELAY });
  return { pedal, log, dev };
}

// ---- Labels -----------------------------------------------------------------

test("display labels are Valeton's 12-A, and every one reads back as its slot", () => {
  assert.equal(slotToDisplayLabel(0), "1-A");
  assert.equal(slotToDisplayLabel(45), "12-B");
  assert.equal(slotToDisplayLabel(255), "64-D");
  for (let s = 0; s < 256; s++) {
    assert.equal(labelToSlot(slotToDisplayLabel(s)), s);
    assert.equal(labelToSlot(slotToDisplayLabel(s).toLowerCase()), s);
  }
  assert.throws(() => slotToDisplayLabel(256), RangeError);
  assert.throws(() => slotToDisplayLabel(-1), RangeError);
});

// ---- Patch list -------------------------------------------------------------

test("patch list: all 256 names, null where a slot couldn't be read", async () => {
  const { dev, log } = setup({
    dumps: new Map([[0, dumpWithName("Clean")], [255, dumpWithName("Last")]]),
    faults: (slot) => (slot === 7 ? [] : undefined), // 2D never answers
  });
  const { names, skipped } = await readPatchList(dev, { skeleton: skeletonBytes(), log });
  assert.equal(names.length, 256);
  assert.equal(names[0], "Clean");
  assert.equal(names[1], EMPTY_PATCH_NAME, "the fake pedal's default dump is an empty slot");
  assert.equal(names[255], "Last");
  assert.equal(names[7], null);
  assert.deepEqual(skipped, ["2D"]);
  assert.ok(log.lines.some((l) => l.includes("Reading the patch list")));
  assert.ok(log.lines.some((l) => l.includes("Read 255 of 256 slots")));
});

// ---- Template plan ----------------------------------------------------------

// 64A empty, 64B the user's, 64C not read, 64D empty.
const range = parseSlotRange("64A", "64D");
const current = new Map([[252, EMPTY_PATCH_NAME], [253, "Hard Rock"], [254, null], [255, EMPTY_PATCH_NAME]]);

test("only 'It's GP-200' counts as empty", () => {
  assert.ok(isEmptyPatchName("It's GP-200"));
  for (const n of ["Template", "It's GP-200 ", "its gp-200", "It's GP-200 2", "", null, undefined]) {
    assert.ok(!isEmptyPatchName(n), `"${n}" is not empty`);
  }
});

test("template plan, default mode: writes empty slots, keeps patches and unread slots", () => {
  const plan = planTemplate(template, range, (s) => current.get(s), "empty");
  assert.deepEqual(plan.items.map((i) => i.label), ["64A", "64D"]);
  assert.deepEqual(plan.kept.map((k) => [k.label, k.name]), [["64B", "Hard Rock"], ["64C", null]]);
  assert.deepEqual(plan.counts, { slots: 4, empty: 2, users: 1, write: 2, keep: 2 });
  assert.deepEqual(plan.unread, ["64C"]);
  assert.equal(plan.items[0].patchName, "Template");
  assert.equal(plan.items[0].replaces, EMPTY_PATCH_NAME);
  assert.equal(plan.items[0].data, template.data, "the .prst is written as it is, as the CLI does");
  assert.equal(templateSummary(plan),
    "\"Template\" (Template.prst) into 64A to 64D: 4 slot(s), 2 empty, 1 with your patches, 1 unread. " +
    "Empty slots only: writes 2, keeps 2 (64B Hard Rock, 64C (not read)).");
  const w = templateWarnings(plan);
  assert.equal(w.length, 1);
  assert.match(w[0], /couldn't be read.*64C.*They are kept/);
});

test("template plan, every slot: writes the whole range, as the CLI does", () => {
  const plan = planTemplate(template, range, (s) => current.get(s), "all");
  assert.deepEqual(plan.items.map((i) => i.label), ["64A", "64B", "64C", "64D"]);
  assert.equal(plan.kept.length, 0);
  assert.equal(plan.items[1].replaces, "Hard Rock");
  assert.match(templateSummary(plan), /Every slot in the range: writes 4\.$/);
  assert.match(templateWarnings(plan)[0], /overwrites them anyway/);
});

test("template plan: nothing empty, bad file, bad mode", () => {
  const full = planTemplate(template, range, () => "Lead", "empty");
  assert.equal(full.items.length, 0);
  assert.match(templateWarnings(full)[0], /^Nothing to write/);
  assert.throws(() => planTemplate({ name: "x.prst", data: new Uint8Array(100) }, range, () => null), /not a valid \.prst/);
  assert.throws(() => planTemplate(template, range, () => null, "some"), RangeError);
});

test("template plan: User-IR/NAM warning when the patch uses them", () => {
  const ir = { name: "ir.prst", data: fixtureBytes("golden/ir_nam.prst") };
  const w = templateWarnings(planTemplate(ir, [0, 1], () => EMPTY_PATCH_NAME));
  assert.equal(w.length, 1);
  assert.match(w[0], /User-IR slot 3/);
});

// ---- Re-check and write against the fake pedal ------------------------------

function rangePedal() {
  return setup({ dumps: new Map([[253, dumpWithName("Hard Rock")], [254, dumpWithName("Lead")]]) });
}

test("template end to end: re-check passes, empty slots written and verified, patches untouched", async () => {
  const { pedal, dev, log } = rangePedal();
  await dev.connect(); // the pedal ignores uploads until editor mode, as the real one does
  const { names } = await readPatchList(dev, { skeleton: skeletonBytes(), log });
  const plan = planTemplate(template, range, (s) => names[s]);
  assert.deepEqual(plan.items.map((i) => i.label), ["64A", "64D"]);

  const check = await recheckTemplate(dev, plan, { skeleton: skeletonBytes(), log });
  assert.ok(check.ok);
  assert.deepEqual(check.changed, []);

  const { failed } = await writeSlots(dev, plan.items, { skeleton: skeletonBytes(), log, betweenSlotsMs: 0 });
  assert.equal(failed.length, 0);
  const nameAt = (s) => extractNameField(pedal.dumpOf(s));
  assert.deepEqual(range.map(nameAt), ["Template", "Hard Rock", "Lead", "Template"]);
  assert.deepEqual([...pedal.writes.keys()].sort(), [252, 255], "only the planned slots received uploads");
  assert.ok(log.lines.some((l) => l.includes("range unchanged since the plan")));
});

test("template re-check: a patch saved on the pedal after the plan stops the write", async () => {
  const { pedal, dev, log } = rangePedal();
  const plan = planTemplate(template, range, (s) => current.get(s) ?? "Lead");
  pedal.dumps.set(252, dumpWithName("New Song")); // saved on the pedal since the list was read
  const check = await recheckTemplate(dev, plan, { skeleton: skeletonBytes(), log });
  assert.ok(!check.ok);
  assert.deepEqual(check.changed, [{ label: "64A", was: EMPTY_PATCH_NAME, now: "New Song" }]);
  assert.equal(pedal.writes.size, 0, "the re-check itself never writes");
  assert.ok(log.lines.some((l) => l.includes("nothing written") && l.includes('64A: "It\'s GP-200" -> "New Song"')));
});

test("template re-check: a slot that can't be read, or a kept slot that became empty, also stops it", async () => {
  const { dev, log } = setup({
    dumps: new Map([[253, dumpWithName("Hard Rock")]]),
    faults: (slot) => (slot === 255 ? [] : undefined), // 64D now unreadable
  });
  // Planned with 64C holding "Lead" (kept); since then it was cleared to empty.
  const plan = planTemplate(template, range, (s) => (s === 254 ? "Lead" : current.get(s)));
  const check = await recheckTemplate(dev, plan, { skeleton: skeletonBytes(), log });
  assert.ok(!check.ok);
  assert.deepEqual(check.changed.map((c) => [c.label, c.was, c.now]),
    [["64D", EMPTY_PATCH_NAME, null], ["64C", "Lead", EMPTY_PATCH_NAME]]);
});

test("template re-check in 'every slot' mode: a changed name stops it too", async () => {
  const { pedal, dev, log } = rangePedal();
  const plan = planTemplate(template, range, (s) => extractNameField(pedal.dumpOf(s)), "all");
  pedal.dumps.set(253, dumpWithName("Hard Rock v2"));
  const check = await recheckTemplate(dev, plan, { skeleton: skeletonBytes(), log });
  assert.deepEqual(check.changed, [{ label: "64B", was: "Hard Rock", now: "Hard Rock v2" }]);
  assert.equal(slotToLabel(plan.items[1].slot), "64B");
});
