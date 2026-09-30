// .prst file building from a device dump, export normalization, names.
// Spec: PROTOCOL.md section 1 in the CLI repo. Ported from gp200.py; pinned
// to it byte-for-byte by tests/golden.test.js.

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
