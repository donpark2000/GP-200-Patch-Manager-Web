// Unit tests for the pure protocol pieces: slots, SysEx, .prst, zip.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPrstFromDump,
  DEAD_BYTE_FILE_OFFSETS,
  normalizeExport,
  prstChecksum,
  safeFilename,
  validateSkeleton,
} from "../src/core/prst.js";
import { skeletonBytes } from "../src/core/skeleton.js";
import { labelToSlot, parseSlotRange, slotsBetween, slotToLabel } from "../src/core/slots.js";
import {
  assembleChunks,
  buildReadRequest,
  chunkOffset,
  describeMessage,
  nibbleDecode,
  nibbleEncode,
} from "../src/core/sysex.js";
import { createZip, crc32 } from "../src/core/zip.js";
import { readZip } from "../src/core/unzip.js";
import { baseDump, fixtureBytes } from "./helpers/fixtures.js";
import { FakePedal } from "./helpers/fake-pedal.js";

test("slot labels round-trip across all 256 slots", () => {
  for (let s = 0; s < 256; s++) assert.equal(labelToSlot(slotToLabel(s)), s);
  assert.equal(slotToLabel(0), "1A");
  assert.equal(slotToLabel(255), "64D");
  assert.equal(labelToSlot(" 34-b "), 133);
});

test("slot labels reject bad input", () => {
  for (const bad of ["", "A", "34", "34E", "0A", "65A", "x1A"]) {
    assert.throws(() => labelToSlot(bad), RangeError, bad);
  }
  assert.throws(() => slotToLabel(256), RangeError);
  assert.throws(() => slotToLabel(-1), RangeError);
  assert.throws(() => parseSlotRange("2A", "1D"), RangeError);
  assert.deepEqual(parseSlotRange("1D", "2B"), [3, 4, 5]);
});

test("slotsBetween: a blank end means the first or last slot", () => {
  assert.equal(slotsBetween("", "").length, 256);
  assert.deepEqual(slotsBetween("", "1C"), [0, 1, 2]); // To only: from 1A
  assert.deepEqual(slotsBetween("64B", " "), [253, 254, 255]); // From only: to 64D
  assert.deepEqual(slotsBetween("2a", "2A"), [4]);
  assert.throws(() => slotsBetween("2A", "1A"), RangeError);
  assert.throws(() => slotsBetween("zz", ""), RangeError);
});

test("nibble encoding round-trips every byte value", () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  const enc = nibbleEncode(all);
  assert.ok(enc.every((b) => b <= 0x0f));
  assert.deepEqual(nibbleDecode(enc), all);
});

test("read request matches the CLI's layout", () => {
  // gp200.py build_read_request(133): 46 bytes, slot nibbles at 25, 37, 41.
  const m = buildReadRequest(133);
  assert.equal(m.length, 46);
  assert.equal(m[0], 0xf0);
  assert.equal(m[m.length - 1], 0xf7);
  assert.deepEqual([m[8], m[9]], [0x11, 0x10]);
  for (const i of [25, 37, 41]) assert.deepEqual([m[i], m[i + 1]], [0x8, 0x5]);
  assert.equal(buildReadRequest(0, true)[9], 0x20);
});

test("chunk offsets use 7 bits per byte", () => {
  const m = new Uint8Array(14);
  m[11] = 0x7f;
  m[12] = 0x02;
  assert.equal(chunkOffset(m), 0x7f | (2 << 7));
});

test("assembleChunks reorders out-of-order chunks", () => {
  const dump = baseDump();
  const chunks = FakePedal.dumpChunks(dump);
  assert.equal(chunks.length, 7);
  assert.deepEqual(assembleChunks([...chunks].reverse()), dump);
});

test("describeMessage shows dump chunks in full and truncates the rest", () => {
  const chunk = FakePedal.dumpChunks(baseDump())[0];
  assert.ok(!describeMessage(chunk).includes("more"));
  assert.match(describeMessage(buildReadRequest(1)), /\+\d+ more/);
  assert.match(describeMessage(Uint8Array.from([0x90, 0x40, 0x7f])), /non-GP-200/);
});

test("embedded skeleton equals the CLI's skeleton.prst", () => {
  assert.deepEqual(skeletonBytes(), fixtureBytes("skeleton.prst"));
  assert.doesNotThrow(() => validateSkeleton(skeletonBytes()));
  assert.throws(() => validateSkeleton(new Uint8Array(1224)));
});

test("buildPrstFromDump never overwrites the checksum, even from a long dump", () => {
  const long = new Uint8Array(1300).fill(0x55);
  const out = buildPrstFromDump(long, skeletonBytes());
  assert.equal(out.length, 1224);
  const c = prstChecksum(out);
  assert.deepEqual([out[0x4c6], out[0x4c7]], [c >> 8, c & 0xff]);
  assert.equal(out[0x4c5], 0x55);
});

test("normalizeExport zeroes dead bytes but keeps 0x34/0x90 slot mirrors", () => {
  const f = Uint8Array.from(skeletonBytes());
  for (const off of [...DEAD_BYTE_FILE_OFFSETS, 0x34, 0x90]) f[off] = 0x91;
  const out = normalizeExport(f);
  for (const off of DEAD_BYTE_FILE_OFFSETS) assert.equal(out[off], 0);
  assert.equal(out[0x34], 0x91);
  assert.equal(out[0x90], 0x91);
});

test("safeFilename edge cases", () => {
  assert.equal(safeFilename(""), "patch");
  assert.equal(safeFilename("   "), "patch");
  assert.equal(safeFilename("a/b"), "a_b");
  assert.equal(safeFilename("\x1cName\x1f"), "Name"); // JS trim() would keep these
  assert.equal(safeFilename("..."), "patch");
});

test("zip: round-trips through a reader, including a non-ASCII name", async () => {
  const entries = [
    { name: "1A_Clean.prst", data: Uint8Array.from([1, 2, 3]) },
    { name: "2A_Amp �x.prst", data: new Uint8Array(0) },
    { name: "3A_Big.prst", data: fixtureBytes("skeleton.prst") },
  ];
  const back = await readZip(createZip(entries));
  assert.deepEqual([...back.keys()], entries.map((e) => e.name));
  for (const e of entries) assert.deepEqual(back.get(e.name), e.data);
});

test("crc32 known value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});
