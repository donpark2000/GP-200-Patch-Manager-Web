// Comparison logic for tools/compare-zips.js (kept separate so tests can
// import it without running the command-line entry point).

import { basename } from "node:path";

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

const labelOf = (name) => basename(name).split("_")[0].toUpperCase();

export function compareZips(a, b) {
  const byLabel = (zip) => new Map([...zip].map(([name, data]) => [labelOf(name), { name, data }]));
  const A = byLabel(a);
  const B = byLabel(b);
  const report = { onlyA: [], onlyB: [], renamed: [], differing: [], identical: 0 };
  for (const [label, ea] of A) {
    const eb = B.get(label);
    if (!eb) { report.onlyA.push(ea.name); continue; }
    if (ea.name !== eb.name) report.renamed.push([ea.name, eb.name]);
    const diffs = [];
    const n = Math.max(ea.data.length, eb.data.length);
    for (let i = 0; i < n; i++) {
      if (ea.data[i] !== eb.data[i]) diffs.push({ off: i, a: ea.data[i], b: eb.data[i] });
    }
    if (diffs.length) report.differing.push({ label, diffs, lenA: ea.data.length, lenB: eb.data.length });
    else report.identical++;
  }
  for (const [label, eb] of B) if (!A.has(label)) report.onlyB.push(eb.name);
  return report;
}
