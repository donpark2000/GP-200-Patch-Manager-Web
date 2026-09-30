// .prst file building from a device dump, export normalization, names.
// Spec: PROTOCOL.md section 1 in the CLI repo. Ported from gp200.py; pinned
// to it byte-for-byte by tests/golden.test.js.
//
// Credit: the .prst layout, the dump-to-file shift of 0x28, and the
// User-IR model-code range come from GP200 Studio (Kabir S. Tamari,
// github.com/kabir0st/gp200-studio, GPL-3.0). The SnapTone (NAM) code
// ranges were confirmed against RigSheet (github.com/ricardo-mv/rigsheet)
// as facts only; no RigSheet code is used. The export normalization rules
// are the CLI's own hardware findings.

import { slotToLabel } from "./slots.js";

export const PRST_LEN = 1224;
export const CHECKSUM_OFF = 0x4c6;
export const CONTENT_FILE_START = 0x28; // file_offset = dump_offset + 0x28

const NAME_DUMP_OFF = 0x44 - CONTENT_FILE_START; // 28
const NAME_LEN = 16;

// Effect blocks, in dump offsets (file 0xA0 - 0x28 = 0x78).
const DUMP_EFFECT_BLOCK_COUNT = 11;
const DUMP_EFFECT_BLOCK_START = 0x78;
const DUMP_EFFECT_BLOCK_SIZE = 0x48;
const DUMP_EFFECT_MODEL_OFFSET = 8;

/** Shortest dump worth accepting: must cover the name and all effect blocks. */
export const MIN_DUMP_LEN = DUMP_EFFECT_BLOCK_START + DUMP_EFFECT_BLOCK_COUNT * DUMP_EFFECT_BLOCK_SIZE;

// File offsets an export forces to 0x00 (PROTOCOL.md "Quick reference").
// Kept as separate named groups, as in the CLI, because each has a different
// reason; see the CLI's constants of the same names.
const tail = (ks) => ks.flatMap((k) => Array.from({ length: 8 }, (_, q) => 1120 + q * 12 + k));
export const TAIL_BLOCK_FILE_OFFSETS = tail([6, 7]);
export const EXPORT_ZEROED_SLOT_ECHO_OFFSET = 0x2e;
export const STUDIO_ADDITIONAL_ZEROED_OFFSETS = [0x3e, 0x40, ...tail([5, 10, 11])];
export const DEAD_BYTE_FILE_OFFSETS = [0x43, 0x9f];

export function prstChecksum(data) {
  let sum = 0;
  for (let i = 0; i < CHECKSUM_OFF; i++) sum += data[i];
  return sum & 0xffff;
}

function writeChecksum(out) {
  const c = prstChecksum(out);
  out[CHECKSUM_OFF] = c >> 8;
  out[CHECKSUM_OFF + 1] = c & 0xff;
}

export function validateSkeleton(bytes) {
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (bytes.length !== PRST_LEN || magic !== "TSRP") {
    throw new Error("not a valid 1224-byte .prst skeleton");
  }
  return bytes;
}

/** Is this a plausible .prst file? (Same test the CLI's upload uses.) */
export function isPrst(bytes) {
  return bytes.length === PRST_LEN && bytes[0] === 0x54 && bytes[1] === 0x53 && bytes[2] === 0x52 && bytes[3] === 0x50;
}

/** Patch name stored in a .prst file (decoded the same way as a dump's). */
export function prstFileName(fileBytes) {
  return extractNameField(fileBytes.subarray(CONTENT_FILE_START));
}

// Fields a correct write is NOT expected to reproduce, so write verification
// ignores them (the CLI's VERIFY_IGNORE_OFFSETS): the PC-software stamp
// (never sent), the three slot mirrors (recomputed for the new slot), and
// the tail block's live bytes. The dead bytes are a separate category, added
// by callers that want them ignored too (DEAD_BYTE_FILE_OFFSETS).
export const VERIFY_IGNORE_OFFSETS = new Set([
  0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x34, 0x90, ...TAIL_BLOCK_FILE_OFFSETS,
]);

/** Compare two .prst buffers over the range a device dump covers, skipping
 *  VERIFY_IGNORE_OFFSETS plus `extraIgnore`. Returns [{off, expected, actual}]
 *  for every other difference (the CLI's diff_prst_content). */
export function diffPrstContent(expected, actual, extraIgnore = []) {
  const ignore = new Set([...VERIFY_IGNORE_OFFSETS, ...extraIgnore]);
  const end = Math.min(expected.length, actual.length, CHECKSUM_OFF);
  const out = [];
  for (let i = CONTENT_FILE_START; i < end; i++) {
    if (!ignore.has(i) && expected[i] !== actual[i]) out.push({ off: i, expected: expected[i], actual: actual[i] });
  }
  return out;
}

/** Human-readable name for a .prst file offset, for mismatch reports. */
export function describeOffset(off) {
  const r = (a, b) => off >= a && off < b;
  if (r(0x00, 0x04)) return "magic";
  if (r(0x1c, 0x20)) return "per-export nonce";
  if (r(0x28, 0x2e)) return "PC-software stamp";
  if (off === 0x2e || off === 0x34 || off === 0x90) return "slot-mirror byte";
  if (off === 0x3e || off === 0x40) return "export-zeroed byte";
  if (off === 0x43 || off === 0x9f) return "dead byte";
  if (r(0x44, 0x54)) return `name[${off - 0x44}]`;
  if (r(0x54, 0x64)) return `author[${off - 0x54}]`;
  if (r(0x64, 0x8c)) return `note[${off - 0x64}]`;
  if (r(0x8c, 0xa0)) return "pre-effects header";
  if (r(0xa0, 0xa0 + 11 * 72)) {
    const block = Math.floor((off - 0xa0) / 72);
    const rel = (off - 0xa0) % 72;
    let what = `+${rel}`;
    if (rel === 4) what = "slot index";
    else if (rel === 5) what = "enabled";
    else if (rel >= 8 && rel < 12) what = "model code";
    else if (rel >= 12) what = `param ${Math.floor((rel - 12) / 4)}`;
    return `effect block ${block} ${what}`;
  }
  if (r(1120, 1120 + 96)) return `tail block entry ${Math.floor((off - 1120) / 12)} +${(off - 1120) % 12}`;
  if (r(0x4c6, 0x4c8)) return "checksum";
  return "other";
}

/** Overlay a device dump onto the skeleton's content region; recompute the checksum. */
export function buildPrstFromDump(decoded, skeleton) {
  const out = Uint8Array.from(skeleton);
  const end = Math.min(CONTENT_FILE_START + decoded.length, CHECKSUM_OFF);
  out.set(decoded.subarray(0, end - CONTENT_FILE_START), CONTENT_FILE_START);
  writeChecksum(out);
  return out;
}

/** Zero the fields that aren't stable patch content, so the same patch
 *  always exports to the same bytes (matches the CLI's
 *  normalize_export_dynamic_fields). Leaves the 0x34/0x90 slot mirrors alone. */
export function normalizeExport(fileBytes) {
  const out = Uint8Array.from(fileBytes);
  for (const off of TAIL_BLOCK_FILE_OFFSETS) out[off] = 0;
  out[EXPORT_ZEROED_SLOT_ECHO_OFFSET] = 0;
  for (const off of STUDIO_ADDITIONAL_ZEROED_OFFSETS) out[off] = 0;
  for (const off of DEAD_BYTE_FILE_OFFSETS) out[off] = 0;
  writeChecksum(out);
  return out;
}

/** The export file for one slot's dump: skeleton overlay, then normalization. */
export function exportPrst(decoded, skeleton) {
  return normalizeExport(buildPrstFromDump(decoded, skeleton));
}

/** Patch name for display and file naming. Matches Python's
 *  bytes.decode("ascii", "replace"): each non-ASCII byte becomes U+FFFD
 *  rather than a confident-looking guess (PROTOCOL.md section 4). */
export function extractNameField(decoded) {
  let s = "";
  for (let i = NAME_DUMP_OFF; i < NAME_DUMP_OFF + NAME_LEN && i < decoded.length; i++) {
    const b = decoded[i];
    if (b === 0) break;
    s += b < 0x80 ? String.fromCharCode(b) : "�";
  }
  return s;
}

// Python's str.strip() with no argument strips these (the ASCII subset of
// str.isspace(), which is all a decoded name can contain). Note it includes
// \x1c-\x1f, which JavaScript's trim() does not.
const PY_WHITESPACE = " \t\n\x0b\x0c\r\x1c\x1d\x1e\x1f";

function pyStrip(s, chars = PY_WHITESPACE) {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

/** Sanitize a patch name for use as a file name (matches the CLI's safe_filename). */
export function safeFilename(name) {
  let n = pyStrip(name) || "patch";
  n = n.replace(/[\\/:*?"<>|]+/g, "_");
  return pyStrip(n, " .") || "patch";
}

/** e.g. "34A_Clean Tone.prst", as the CLI's export names it. */
export function exportFileName(slot, decoded) {
  const label = slotToLabel(slot);
  return `${label}_${safeFilename(extractNameField(decoded) || label)}.prst`;
}

/** Effect blocks that point at a User-IR or SnapTone (NAM) slot by number;
 *  a backup can't carry that slot's content (PROTOCOL.md section 4). */
export function findIrNamDependencies(decoded) {
  const found = [];
  for (let i = 0; i < DUMP_EFFECT_BLOCK_COUNT; i++) {
    const base = DUMP_EFFECT_BLOCK_START + i * DUMP_EFFECT_BLOCK_SIZE + DUMP_EFFECT_MODEL_OFFSET;
    if (base + 4 > decoded.length) continue;
    const code =
      (decoded[base] | (decoded[base + 1] << 8) | (decoded[base + 2] << 16) | (decoded[base + 3] << 24)) >>> 0;
    const desc = describeIrNamDependency(code);
    if (desc) found.push(desc);
  }
  return found;
}

function describeIrNamDependency(code) {
  if (code >= 0x0a100000 && code < 0x0a100000 + 30) return `User-IR slot ${code - 0x0a100000}`;
  if (code >= 0x0f000000 && code < 0x0f000005) return `SnapTone (NAM) slot ${code - 0x0f000000} (amp)`;
  if (code >= 0x0f000005 && code < 0x0f00000a) return `SnapTone (NAM) slot ${code - 0x0f000005} (dist)`;
  return null;
}
