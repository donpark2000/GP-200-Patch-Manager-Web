// Comparison logic for tools/compare-zips.js (kept separate so tests can
// import it without running the command-line entry point).

import { basename } from "node:path";
import { CHECKSUM_OFF, PEDAL_MANAGED_FILE_OFFSETS, prstChecksum } from "../src/core/prst.js";
import { labelToSlot, slotToLabel } from "../src/core/slots.js";
export { describeOffset } from "../src/core/prst.js";

const labelOf = (name) => basename(name).split("_")[0].toUpperCase();
const afterLabel = (name) => basename(name).split("_").slice(1).join("_");

/** Slot-mirror bytes: they hold the slot number, so they differ when a patch moves. */
export const SLOT_MIRROR_OFFSETS = [0x34, 0x90];
const CHECKSUM_OFFSETS = [CHECKSUM_OFF, CHECKSUM_OFF + 1];

const checksumOk = (d) => d.length < CHECKSUM_OFF + 2 || ((d[CHECKSUM_OFF] << 8) | d[CHECKSUM_OFF + 1]) === prstChecksum(d);

/**
 * Compare zip `b` with zip `a`, slot by slot. Every byte counts, except:
 * pedal-managed bytes (prst.js) are reported separately (`managedOnly`, or
 * `managed` on a differing slot) and don't make a slot differ; the checksum
 * is checked for validity in each file instead of compared (it follows the
 * content). With `shift` N, b's slot n is compared with a's slot n - N, as
 * after restoring `a` from slot N (slots below N are compared unshifted, and
 * the slot mirrors are ignored, since they hold each slot's own number).
 */
export function compareZips(a, b, { shift = 0 } = {}) {
  const byLabel = (zip) => new Map([...zip].map(([name, data]) => [labelOf(name), { name, data }]));
  const A = byLabel(a);
  const B = byLabel(b);
  const report = {
    onlyA: [], onlyB: [], renamed: [], differing: [], managedOnly: [], identical: 0,
    entriesA: a.size, entriesB: b.size, bytesCompared: 0, slotsCompared: 0, shift, mirrorsIgnored: 0,
  };
  const sourceOf = (label) => {
    if (!shift) return label;
    const n = labelToSlot(label);
    return n >= shift ? slotToLabel(n - shift) : label;
  };
  const used = new Set();
  for (const [label, eb] of B) {
    const src = sourceOf(label);
    const ea = A.get(src);
    if (!ea) { report.onlyB.push(eb.name); continue; }
    used.add(src);
    const sameName = shift ? afterLabel(ea.name) === afterLabel(eb.name) : ea.name === eb.name;
    if (!sameName) report.renamed.push([ea.name, eb.name]);
    const diffs = [];
    const managed = [];
    const n = Math.max(ea.data.length, eb.data.length);
    report.bytesCompared += n;
    report.slotsCompared++;
    for (let i = 0; i < n; i++) {
      if (ea.data[i] === eb.data[i] || CHECKSUM_OFFSETS.includes(i)) continue;
      const d = { off: i, a: ea.data[i], b: eb.data[i] };
      if (PEDAL_MANAGED_FILE_OFFSETS.includes(i)) managed.push(d);
      else if (shift && src !== label && SLOT_MIRROR_OFFSETS.includes(i)) report.mirrorsIgnored++;
      else diffs.push(d);
    }
    for (const [which, d] of [["a", ea.data], ["b", eb.data]]) {
      if (!checksumOk(d)) diffs.push({ off: CHECKSUM_OFF, a: ea.data[CHECKSUM_OFF], b: eb.data[CHECKSUM_OFF], badChecksum: which });
    }
    const entry = { label, source: src, diffs, managed, lenA: ea.data.length, lenB: eb.data.length };
    if (diffs.length) report.differing.push(entry);
    else if (managed.length) report.managedOnly.push(entry);
    else report.identical++;
  }
  // With a shift, a's top slots have nowhere to go (they didn't fit), so
  // they're expected to be missing from the comparison.
  for (const [label, ea] of A) if (!used.has(label) && !(shift && labelToSlot(label) >= 256 - shift)) report.onlyA.push(ea.name);
  return report;
}

/** True when nothing but pedal-managed bytes differ. */
export const isMatch = (rep) => !rep.onlyA.length && !rep.onlyB.length && !rep.renamed.length && !rep.differing.length;
