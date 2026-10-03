// What the designed UI's screens say (src/core/screens.js): range boxes,
// summaries, confirmations and the "After" view, from plans and names.

import assert from "node:assert/strict";
import { test } from "node:test";
import { exportPrst } from "../src/core/prst.js";
import {
  afterNames,
  backupFileName,
  backupSummary,
  parseRange,
  parseStart,
  replaceCounts,
  restoreConfirmText,
  restoreSummary,
  screenAfterConnect,
  templateConfirmText,
  templateScreenSummary,
} from "../src/core/screens.js";
import { skeletonBytes } from "../src/core/skeleton.js";
import { EMPTY_PATCH_NAME, planTemplate } from "../src/core/template.js";
import { planUpload } from "../src/core/upload.js";
import { dumpWithName } from "./helpers/fixtures.js";

const prstNamed = (name) => exportPrst(dumpWithName(name), skeletonBytes());
// 12-A (slot 44) "Oldschool Fuzz", 12-B empty, 12-C not read, 12-D "Lead"; the rest empty.
const names = new Map([[44, "Oldschool Fuzz"], [45, EMPTY_PATCH_NAME], [46, null], [47, "Lead"]]);
const nameOf = (s) => (names.has(s) ? names.get(s) : EMPTY_PATCH_NAME);

test("range boxes: 12-A or 12A, blanks mean 1-A / 64-D, errors in the 12-A style", () => {
  assert.deepEqual(parseRange("12-A", "12-d").slots, [44, 45, 46, 47]);
  assert.deepEqual(parseRange(" 12a ", "12A").slots, [44]);
  assert.equal(parseRange("", "").slots.length, 256);
  assert.deepEqual(parseRange("", "1-B").slots, [0, 1]);
  assert.equal(parseRange("64-D", "").slots[0], 255);
  assert.deepEqual(parseRange("12-E", "13A"), { error: "From isn't a slot (e.g. 12-A)" });
  assert.deepEqual(parseRange("1A", "65A"), { error: "To isn't a slot (e.g. 12-A)" });
  assert.deepEqual(parseRange("13A", "12D"), { error: "13-A comes after 12-D" });
});

test("start box: required, either label style", () => {
  assert.deepEqual(parseStart("34-a"), { slot: 132 });
  assert.deepEqual(parseStart("  "), { error: "Enter a start slot (e.g. 34-A)" });
  assert.deepEqual(parseStart("0A"), { error: "Start isn't a slot (e.g. 34-A)" });
});

test("backup summary and file name match the CLI's naming", () => {
  assert.equal(backupSummary(parseRange("12A", "12D").slots, nameOf), "4 slots: 12-A to 12-D, saved as gp200_12A_to_12D.zip");
  assert.equal(backupSummary(parseRange("", "").slots, nameOf), "All 256 slots: 1-A to 64-D, saved as gp200_all_patches.zip");
  assert.equal(backupSummary([44], nameOf), "1 slot: 12-A to 12-A, saved as 12A_Oldschool Fuzz.prst");
  assert.equal(backupFileName([46], nameOf), "12C_<name>.prst", "name not read yet");
  assert.equal(backupFileName([47], () => "a/b"), "12D_a_b.prst", "unsafe characters as the CLI replaces them");
});

test("replace counts: yours, empty, not read", () => {
  assert.deepEqual(replaceCounts([44, 45, 46, 47, 48], nameOf), { yours: 2, empty: 2, unknown: 1 });
});

test("restore summary, overflow and confirmation", () => {
  const files = ["a", "b", "c", "d"].map((n) => ({ name: `${n}.prst`, data: prstNamed(n.toUpperCase()) }));
  const plan = planUpload(files, 44);
  const s = restoreSummary(plan, nameOf);
  assert.equal(s.text, "4 files go to 12-A to 12-D, replacing 2 of your patches, 1 empty slot, 1 slot not read. " +
    "Hover a slot to see which file goes there.");
  assert.equal(s.overflowText, null);
  assert.equal(restoreConfirmText(plan, nameOf),
    "Write 4 patches to 12-A to 12-D? This replaces 2 of your patches, 1 empty slot, 1 slot not read.");
  assert.deepEqual([...afterNames(plan.items)], [[44, "A"], [45, "B"], [46, "C"], [47, "D"]]);

  const over = planUpload(files, 254); // 64-C: two fit, two don't
  const o = restoreSummary(over, nameOf);
  assert.match(o.text, /^2 files go to 64-C to 64-D, replacing 2 empty slots\./);
  assert.equal(o.overflowText, "2 files don't fit after 64-D and won't be written.");
  const one = restoreSummary(planUpload(files, 255), nameOf);
  assert.equal(one.overflowText, "3 files don't fit after 64-D and won't be written.");
  assert.equal(restoreSummary(planUpload([], 0), nameOf).text, "Nothing to write.");
});

test("template screen summary and confirmation, both modes", () => {
  const file = { name: "Clean Start.prst", data: prstNamed("Clean Start") };
  const range = parseRange("12A", "12D").slots;
  const safe = planTemplate(file, range, nameOf, "empty");
  assert.equal(templateScreenSummary(safe).text,
    "4 slots, 12-A to 12-D (1 empty, 2 of your patches, 1 not read). Writes 1. " +
    "Keeps 3: 12-A Oldschool Fuzz, 12-C (not read), 12-D Lead.");
  assert.equal(templateConfirmText(safe), "Write Clean Start.prst to 1 slot between 12-A and 12-D? 3 kept.");

  const all = planTemplate(file, range, nameOf, "all");
  assert.equal(templateScreenSummary(all).text,
    "4 slots, 12-A to 12-D (1 empty, 2 of your patches, 1 not read). Writes 4, 2 of them your own patches.");
  assert.equal(templateConfirmText(all), "Write Clean Start.prst to 4 slots between 12-A and 12-D? 2 of them hold your own patches.");

  const none = planTemplate(file, [44, 47], nameOf, "empty");
  assert.match(templateScreenSummary(none).text, /Nothing to write\.$/);

  const many = planTemplate(file, parseRange("1A", "2D").slots, (s) => (s === 0 ? EMPTY_PATCH_NAME : "Mine"), "empty");
  assert.match(templateScreenSummary(many).text, /Writes 1\. Keeps 7: 1-B Mine, .*, 2-C Mine, and 1 more\.$/);
});

test("after connecting: Back up first; after a lost connection, back where the user was", () => {
  for (const s of ["home", "backup", "restore", "template", "help", "nonsense"]) {
    assert.equal(screenAfterConnect(s, false), "backup", `first connection from ${s}`);
  }
  assert.equal(screenAfterConnect("restore", true), "restore");
  assert.equal(screenAfterConnect("template", true), "template");
  assert.equal(screenAfterConnect("backup", true), "backup");
  // The home page and Help aren't pedal screens: go to Back up.
  assert.equal(screenAfterConnect("home", true), "backup");
  assert.equal(screenAfterConnect("help", true), "backup");
});
