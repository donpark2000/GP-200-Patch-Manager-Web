#!/usr/bin/env node
// Compare the .prst files inside two export zips slot by slot and byte by
// byte: the phase 1 test (CLI export vs web export) and the phase 2 gate
// (backup vs export after a restore).
//
//   node tools/compare-zips.js <a.zip> <b.zip> [--shift N]
//
// Entries are matched by the slot label their file name starts with
// ("34A_..."), so a name-only difference is reported separately from a
// content difference. With --shift N, b's slot n is compared with a's slot
// n - N (after restoring a from slot N; slot mirrors ignored). Pedal-managed
// bytes (0x44e/0x456, not settings) are listed but don't fail the compare.
// Exit code 0 only on MATCH.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { compareZips, describeOffset, isMatch } from "./compare-lib.js";
import { readZip } from "../src/core/unzip.js";

const hex = (x) => (x === undefined ? "--" : x.toString(16).padStart(2, "0"));

const args = process.argv.slice(2);
const si = args.indexOf("--shift");
const shift = si >= 0 ? Number(args.splice(si, 2)[1]) : 0;
const [fileA, fileB] = args;
if (!fileA || !fileB || !Number.isInteger(shift) || shift < 0 || shift > 255) {
  console.error("usage: node tools/compare-zips.js <a.zip> <b.zip> [--shift N]");
  process.exit(2);
}
const rep = compareZips(await readZip(readFileSync(fileA)), await readZip(readFileSync(fileB)), { shift });
const A = basename(fileA);
const B = basename(fileB);
if (shift) console.log(`Shifted compare: ${B}'s slot n against ${A}'s slot n-${shift} (slot mirrors ignored)`);
console.log(`${A}: ${rep.entriesA} entries; ${B}: ${rep.entriesB} entries; ${rep.slotsCompared} slot(s), ` +
  `${rep.bytesCompared.toLocaleString("en-US")} bytes compared`);
console.log(`${rep.identical} slot(s) identical`);
const offs = (ds) => ds.map((x) => `0x${x.off.toString(16)} ${hex(x.a)} vs ${hex(x.b)}`).join(", ");
const pair = (d) => (d.source === d.label ? d.label : `${d.label} (vs ${d.source})`);
if (rep.managedOnly.length) {
  console.log(`${rep.managedOnly.length} slot(s) differ only in pedal-managed bytes (not settings; don't fail the compare):`);
  for (const d of rep.managedOnly) console.log(`  ${pair(d)}: ${offs(d.managed)}`);
}
for (const n of rep.onlyA) console.log(`only in ${A}: ${n}`);
for (const n of rep.onlyB) console.log(`only in ${B}: ${n}`);
for (const [x, y] of rep.renamed) console.log(`file name differs: ${x}  vs  ${y}`);
for (const d of rep.differing) {
  const len = d.lenA === d.lenB ? "" : ` (lengths ${d.lenA} vs ${d.lenB})`;
  console.log(`${pair(d)}: ${d.diffs.length} byte(s) differ${len}` + (d.managed.length ? `; also pedal-managed ${offs(d.managed)}` : ""));
  for (const x of d.diffs.slice(0, 20)) {
    const what = x.badChecksum ? `invalid checksum in ${x.badChecksum === "a" ? A : B}` : describeOffset(x.off);
    console.log(`  0x${x.off.toString(16).padStart(3, "0")} ${hex(x.a)} vs ${hex(x.b)}  ${what}`);
  }
  if (d.diffs.length > 20) console.log(`  ... ${d.diffs.length - 20} more`);
}
const ok = isMatch(rep);
console.log(ok
  ? `RESULT: MATCH${rep.managedOnly.length ? ` (${rep.managedOnly.length} slot(s) with pedal-managed bytes changed)` : ""}`
  : "RESULT: DIFFERENT");
process.exitCode = ok ? 0 : 1;
