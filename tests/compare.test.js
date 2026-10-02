// The zip compare tool used for the phase 1 acceptance test.

import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { test } from "node:test";
import { compareZips, describeOffset, isMatch } from "../tools/compare-lib.js";
import { exportPrst, prstChecksum } from "../src/core/prst.js";
import { skeletonBytes } from "../src/core/skeleton.js";
import { dumpWithName } from "./helpers/fixtures.js";
import { createZip, crc32 } from "../src/core/zip.js";
import { readZip } from "../src/core/unzip.js";

const bytes = (...xs) => Uint8Array.from(xs);

test("identical contents under the same names match", () => {
  const a = new Map([["1A_X.prst", bytes(1, 2)], ["1B_Y.prst", bytes(3)]]);
  const rep = compareZips(a, new Map(a));
  assert.equal(rep.identical, 2);
  assert.equal(rep.bytesCompared, 3);
  assert.equal(rep.entriesA, 2);
  assert.equal(rep.differing.length + rep.onlyA.length + rep.onlyB.length + rep.renamed.length, 0);
});

test("reports byte diffs, renames, and missing slots separately", () => {
  const a = new Map([["1A_X.prst", bytes(1, 2)], ["1B_Y.prst", bytes(3)], ["1C_Z.prst", bytes(0)]]);
  const b = new Map([["1A_X.prst", bytes(1, 9)], ["1B_Other.prst", bytes(3)], ["1D_W.prst", bytes(0)]]);
  const rep = compareZips(a, b);
  assert.deepEqual(rep.differing[0].diffs, [{ off: 1, a: 2, b: 9 }]);
  assert.deepEqual(rep.renamed, [["1B_Y.prst", "1B_Other.prst"]]);
  assert.deepEqual(rep.onlyA, ["1C_Z.prst"]);
  assert.deepEqual(rep.onlyB, ["1D_W.prst"]);
});

test("describeOffset names the known regions", () => {
  assert.equal(describeOffset(0x9f), "dead byte");
  assert.equal(describeOffset(0x90), "slot-mirror byte");
  assert.equal(describeOffset(0x45), "name[1]");
  assert.equal(describeOffset(0xa0 + 72 * 3 + 12 + 4 * 2), "effect block 3 param 2");
  assert.equal(describeOffset(1120 + 12 * 2 + 7), "tail block entry 2 +7");
  assert.equal(describeOffset(0x4c7), "checksum");
});

test("zip reader handles deflated entries, like the CLI's zips", async () => {
  // Build a one-entry deflated zip by hand, as Python's zipfile would.
  const data = new TextEncoder().encode("hello hello hello hello");
  const comp = deflateRawSync(data);
  const stored = createZip([{ name: "1A_A.prst", data }]);
  const v = new DataView(stored.buffer);
  const name = new TextEncoder().encode("1A_A.prst");
  const local = stored.slice(0, 30 + name.length);
  const lv = new DataView(local.buffer);
  lv.setUint16(8, 8, true);
  lv.setUint32(18, comp.length, true);
  const central = stored.slice(30 + name.length + data.length, stored.length - 22);
  const cv = new DataView(central.buffer);
  cv.setUint16(10, 8, true);
  cv.setUint32(20, comp.length, true);
  const end = stored.slice(stored.length - 22);
  new DataView(end.buffer).setUint32(16, local.length + comp.length, true);
  const zip = Uint8Array.from([...local, ...comp, ...central, ...end]);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.deepEqual((await readZip(zip)).get("1A_A.prst"), data);
  assert.equal(crc32(data), cv.getUint32(16, true));
});

// ---- Pedal-managed bytes and the shifted compare (phase 2 gate) -----------

const patch = (name, slot = 0, managed = 0) => {
  const d = dumpWithName(name);
  d[0x456 - 0x28] = managed;
  for (const off of [0x34, 0x90]) d[off - 0x28] = slot;
  return exportPrst(d, skeletonBytes());
};
const zipOf = (...entries) => new Map(entries);

test("pedal-managed bytes: listed separately and don't fail the compare; checksum follows the content", () => {
  const a = zipOf(["1A_X.prst", patch("X", 0, 2)], ["1B_Y.prst", patch("Y", 1, 2)]);
  const b = zipOf(["1A_X.prst", patch("X", 0, 0)], ["1B_Y.prst", patch("Y", 1, 2)]);
  const rep = compareZips(a, b);
  assert.equal(rep.identical, 1);
  assert.deepEqual(rep.managedOnly.map((d) => [d.label, d.managed]), [["1A", [{ off: 0x456, a: 2, b: 0 }]]]);
  assert.equal(rep.differing.length, 0, "the checksum differs too, but only because of the managed byte");
  assert.ok(isMatch(rep));
});

test("pedal-managed bytes: a real difference still fails, with the managed byte listed too", () => {
  const a = zipOf(["1A_X.prst", patch("X", 0, 2)]);
  const bad = patch("X", 0, 0);
  bad[0xa5] ^= 1; // effect block 0 enabled
  bad.set([prstChecksum(bad) >> 8, prstChecksum(bad) & 0xff], 0x4c6);
  const rep = compareZips(a, zipOf(["1A_X.prst", bad]));
  assert.deepEqual(rep.differing[0].diffs.map((d) => d.off), [0xa5]);
  assert.deepEqual(rep.differing[0].managed.map((d) => d.off), [0x456]);
  assert.ok(!isMatch(rep));
});

test("an invalid checksum is reported even when the content matches", () => {
  const good = patch("X");
  const bad = Uint8Array.from(good);
  bad[0x4c7] ^= 1;
  const rep = compareZips(zipOf(["1A_X.prst", good]), zipOf(["1A_X.prst", bad]));
  assert.deepEqual(rep.differing[0].diffs.map((d) => [d.off, d.badChecksum]), [[0x4c6, "b"]]);
  assert.ok(!isMatch(rep));
});

test("--shift 1: slot n against slot n-1, slot mirrors ignored, 1A unshifted, the top slot expected missing", () => {
  const a = zipOf(["1A_P.prst", patch("P", 0)], ["1B_Q.prst", patch("Q", 1)], ["1C_R.prst", patch("R", 2)], ["64D_Z.prst", patch("Z", 255)]);
  const b = zipOf(["1A_P.prst", patch("P", 0)], ["1B_P.prst", patch("P", 1)], ["1C_Q.prst", patch("Q", 2, 2)], ["1D_R.prst", patch("R", 3)]);
  const rep = compareZips(a, b, { shift: 1 });
  assert.equal(rep.slotsCompared, 4);
  assert.equal(rep.identical, 3);
  assert.deepEqual(rep.managedOnly.map((d) => [d.label, d.source]), [["1C", "1B"]]);
  assert.equal(rep.mirrorsIgnored, 6, "two mirror bytes in each of 1B, 1C, 1D");
  assert.deepEqual(rep.onlyA, [], "64D didn't fit, so it isn't missing");
  assert.ok(isMatch(rep));
  // A patch in the wrong place is caught: swap two.
  const swapped = zipOf(["1A_P.prst", patch("P", 0)], ["1B_Q.prst", patch("Q", 1)], ["1C_P.prst", patch("P", 2)], ["1D_R.prst", patch("R", 3)]);
  const bad = compareZips(a, swapped, { shift: 1 });
  assert.ok(!isMatch(bad));
  assert.deepEqual(bad.renamed, [["1A_P.prst", "1B_Q.prst"], ["1B_Q.prst", "1C_P.prst"]]);
  assert.deepEqual(bad.differing.map((d) => d.label), ["1B", "1C"]);
});

test("without a shift, the slot mirrors count (a patch in another slot is a difference)", () => {
  const rep = compareZips(zipOf(["1A_X.prst", patch("X", 0)]), zipOf(["1A_X.prst", patch("X", 7)]));
  assert.deepEqual(rep.differing[0].diffs.map((d) => d.off), [0x34, 0x90]);
});
