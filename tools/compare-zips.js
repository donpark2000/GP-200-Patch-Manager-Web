#!/usr/bin/env node
// Phase 1 acceptance test helper (DESIGN.md): compare the .prst files inside
// two export zips -- e.g. the CLI's `export --all` and the web app's export
// all -- slot by slot and byte by byte.
//
//   node tools/compare-zips.js <cli.zip> <web.zip>
//
// Entries are matched by the slot label their file name starts with
// ("34A_..."), so a name-only difference is reported separately from a
// content difference. Exit code 0 only if every slot matches exactly.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { compareZips, describeOffset } from "./compare-lib.js";
import { readZip } from "../src/core/unzip.js";

const hex = (x) => (x === undefined ? "--" : x.toString(16).padStart(2, "0"));

const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) {
  console.error("usage: node tools/compare-zips.js <cli.zip> <web.zip>");
  process.exit(2);
}
const rep = compareZips(await readZip(readFileSync(fileA)), await readZip(readFileSync(fileB)));
const A = basename(fileA);
const B = basename(fileB);
console.log(`${A}: ${rep.entriesA} entries; ${B}: ${rep.entriesB} entries; ` +
  `${rep.bytesCompared.toLocaleString("en-US")} bytes compared`);
console.log(`${rep.identical} slot(s) identical`);
for (const n of rep.onlyA) console.log(`only in ${A}: ${n}`);
for (const n of rep.onlyB) console.log(`only in ${B}: ${n}`);
for (const [x, y] of rep.renamed) console.log(`file name differs: ${x}  vs  ${y}`);
for (const d of rep.differing) {
  const len = d.lenA === d.lenB ? "" : ` (lengths ${d.lenA} vs ${d.lenB})`;
  console.log(`${d.label}: ${d.diffs.length} byte(s) differ${len}`);
  for (const x of d.diffs.slice(0, 20)) {
    console.log(`  0x${x.off.toString(16).padStart(3, "0")} ${hex(x.a)} vs ${hex(x.b)}  ${describeOffset(x.off)}`);
  }
  if (d.diffs.length > 20) console.log(`  ... ${d.diffs.length - 20} more`);
}
const clean = !rep.onlyA.length && !rep.onlyB.length && !rep.renamed.length && !rep.differing.length;
console.log(clean ? "RESULT: MATCH" : "RESULT: DIFFERENT");
process.exitCode = clean ? 0 : 1;
