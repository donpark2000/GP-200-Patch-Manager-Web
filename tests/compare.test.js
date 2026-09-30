// The zip compare tool used for the phase 1 acceptance test.

import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { test } from "node:test";
import { compareZips, describeOffset } from "../tools/compare-lib.js";
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
