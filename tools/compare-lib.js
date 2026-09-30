// Comparison logic for tools/compare-zips.js (kept separate so tests can
// import it without running the command-line entry point).

import { basename } from "node:path";
export { describeOffset } from "../src/core/prst.js";

const labelOf = (name) => basename(name).split("_")[0].toUpperCase();

export function compareZips(a, b) {
  const byLabel = (zip) => new Map([...zip].map(([name, data]) => [labelOf(name), { name, data }]));
  const A = byLabel(a);
  const B = byLabel(b);
  const report = { onlyA: [], onlyB: [], renamed: [], differing: [], identical: 0, entriesA: a.size, entriesB: b.size, bytesCompared: 0 };
  for (const [label, ea] of A) {
    const eb = B.get(label);
    if (!eb) { report.onlyA.push(ea.name); continue; }
    if (ea.name !== eb.name) report.renamed.push([ea.name, eb.name]);
    const diffs = [];
    const n = Math.max(ea.data.length, eb.data.length);
    report.bytesCompared += n;
    for (let i = 0; i < n; i++) {
      if (ea.data[i] !== eb.data[i]) diffs.push({ off: i, a: ea.data[i], b: eb.data[i] });
    }
    if (diffs.length) report.differing.push({ label, diffs, lenA: ea.data.length, lenB: eb.data.length });
    else report.identical++;
  }
  for (const [label, eb] of B) if (!A.has(label)) report.onlyB.push(eb.name);
  return report;
}
