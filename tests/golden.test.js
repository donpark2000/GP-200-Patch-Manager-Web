// Parity with the CLI: every golden case was produced by the CLI's own
// Python functions (tools/make_golden.py). The JS port must match exactly.

import assert from "node:assert/strict";
import { test } from "node:test";
import { exportFileName, exportPrst, extractNameField, findIrNamDependencies } from "../src/core/prst.js";
import { skeletonBytes } from "../src/core/skeleton.js";
import { slotToLabel } from "../src/core/slots.js";
import { fixtureBytes, goldenManifest } from "./helpers/fixtures.js";

const manifest = goldenManifest();

test("golden manifest covers the expected cases", () => {
  assert.ok(manifest.cases.length >= 10);
});

for (const c of manifest.cases) {
  test(`golden: ${c.case}`, () => {
    const dump = fixtureBytes(`golden/${c.case}.dump.bin`);
    const expected = fixtureBytes(`golden/${c.case}.prst`);
    assert.equal(slotToLabel(c.slot), c.label);
    assert.deepEqual(exportPrst(dump, skeletonBytes()), expected, ".prst bytes differ from the CLI's");
    assert.equal(extractNameField(dump), c.display_name);
    assert.equal(exportFileName(c.slot, dump), c.file_name);
    assert.deepEqual(findIrNamDependencies(dump), c.ir_nam);
  });
}
