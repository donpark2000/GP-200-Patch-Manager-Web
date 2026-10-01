// Restoring patches: turn picked files into a plan (which file goes to
// which slot), then write and verify each one. Mirrors the CLI's `upload`
// (one .prst, several, or one .zip, filled into consecutive slots from a
// starting slot). Nothing here runs without the user confirming the plan.

import { findIrNamDependencies, isPrst, prstFileName, describeOffset, CONTENT_FILE_START } from "./prst.js";
import { plannedWriteMs, slowWriteWarning } from "./device.js";
import { labelToSlot, slotToLabel, TOTAL_SLOTS } from "./slots.js";
import { readZip } from "./unzip.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Slot number from a leading label like "37A_..." or "36-A JImi.prst",
 *  else null (the CLI's _parse_leading_slot_label). Used only for ORDER. */
export function parseLeadingSlotLabel(fileName) {
  const base = fileName.split(/[\\/]/).pop();
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const prefix = stem.split(/[\s_]/, 1)[0];
  try {
    return labelToSlot(prefix);
  } catch {
    return null;
  }
}

/**
 * Picked files -> the list of .prst entries to restore.
 * Accepts .prst files, or exactly one .zip (not both), as the CLI does.
 * @param {{name: string, data: Uint8Array}[]} files
 * @returns {Promise<{entries: {name: string, data: Uint8Array}[], notes: string[]}>}
 */
export async function expandSources(files) {
  const zips = files.filter((f) => f.name.toLowerCase().endsWith(".zip"));
  if (zips.length > 1) throw new Error("Pick one .zip at a time.");
  if (zips.length && files.length > 1) throw new Error("Pick either one .zip or some .prst files, not both.");
  const notes = [];
  if (!zips.length) return { entries: files, notes };

  const zip = await readZip(zips[0].data);
  const entries = [];
  for (const [name, data] of zip) {
    if (name.endsWith("/")) continue;
    if (name.toLowerCase().endsWith(".prst")) entries.push({ name, data });
    else notes.push(`${zips[0].name}: skipping ${name} (not a .prst file)`);
  }
  if (!entries.length) throw new Error(`${zips[0].name} has no .prst files in it.`);
  return { entries, notes };
}

/** Order entries the CLI's way: by embedded slot label if EVERY name has
 *  one, otherwise alphabetically (case-insensitive). The browser doesn't
 *  guarantee the order of picked files, so plain files get the same rule. */
export function orderEntries(entries) {
  const labels = entries.map((e) => parseLeadingSlotLabel(e.name));
  if (labels.every((l) => l !== null)) {
    const withLabel = entries.map((e, i) => ({ e, l: labels[i], i }));
    withLabel.sort((a, b) => a.l - b.l || a.i - b.i);
    return { ordered: withLabel.map((x) => x.e), orderedBy: "slot label" };
  }
  const key = (e) => e.name.toLowerCase();
  const ordered = [...entries].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return { ordered, orderedBy: "file name (not every name starts with a slot label)" };
}

/**
 * Assign ordered entries to consecutive slots from `startSlot`. As in the
 * CLI, an invalid file still takes its slot position (that slot is left
 * unchanged), and files past 64D are not written.
 */
export function planUpload(orderedEntries, startSlot) {
  const items = [];
  const skipped = [];
  const overflow = [];
  orderedEntries.forEach((e, i) => {
    const slot = startSlot + i;
    if (slot >= TOTAL_SLOTS) {
      overflow.push(e.name);
      return;
    }
    if (!isPrst(e.data)) {
      skipped.push({ fileName: e.name, label: slotToLabel(slot), reason: "not a valid .prst file; this slot is left unchanged" });
      return;
    }
    items.push({
      fileName: e.name,
      data: e.data,
      slot,
      label: slotToLabel(slot),
      patchName: prstFileName(e.data),
      irNam: findIrNamDependencies(e.data.subarray(CONTENT_FILE_START)),
    });
  });
  return { items, skipped, overflow };
}

/** Plain-language warnings to show with the plan, before anything is written. */
export function planWarnings(plan) {
  const out = [];
  for (const s of plan.skipped) out.push(`${s.fileName} -> ${s.label}: ${s.reason}.`);
  if (plan.overflow.length) {
    out.push(`${plan.overflow.length} file(s) don't fit before 64D and won't be written: ${plan.overflow.join(", ")}.`);
  }
  const deps = plan.items.filter((it) => it.irNam.length);
  if (deps.length) {
    out.push(`${deps.length} patch(es) use User-IR/SnapTone (NAM) slots: ` +
      deps.map((it) => `${it.label}: ${it.irNam.join(", ")}`).join("; ") +
      ". A patch only stores the slot NUMBER, so these will sound right only if the same IR/NAM " +
      "is loaded in that same slot on this pedal.");
  }
  return out;
}

/**
 * Write and verify each planned item, in order (device.writeSlot: upload,
 * read back until it matches, preset change). Stops between patches (never
 * mid-patch) if cancelled. `betweenSlotsMs` is 0: the CLI's 300 ms pause
 * proved unnecessary on hardware (DEV_JOURNAL.md T2).
 * @param {import("./device.js").GP200} device
 * @param {object} opts
 * @param {(sinceMs: number) => boolean} [opts.wasHidden] true if the page was
 *   hidden at any point since performance.now() was `sinceMs` (UI supplies it)
 */
export async function writeSlots(device, items, {
  skeleton, log, onProgress = () => {}, isCancelled = () => false, betweenSlotsMs = 0, wasHidden = () => false,
}) {
  const results = [];
  let cancelled = false;
  const started = performance.now();
  for (let i = 0; i < items.length; i++) {
    if (isCancelled()) {
      cancelled = true;
      log.warn(`Stopped after ${i} of ${items.length} patches; the rest were not written`);
      break;
    }
    const it = items[i];
    log.info(`${it.fileName} -> ${it.label}: writing "${it.patchName}"`);
    const writeStarted = performance.now();
    const v = await device.writeSlot(it.slot, it.data, skeleton);
    const slow = slowWriteWarning(it.label, { totalMs: v.totalMs, plannedMs: plannedWriteMs(device.timing) }, wasHidden(writeStarted));
    if (slow) log.warn(slow);
    else log.debug(`${it.label}: written in ${v.totalMs.toFixed(0)} ms (read back after ${v.readBackMs.toFixed(0)} ms, ${v.reads} read(s))`);
    if (v.ok) {
      log.info(`${it.label}: verified, now reads "${v.deviceName}"`);
    } else {
      log.error(`${it.label}: WRITE NOT VERIFIED (${v.reason})`);
      for (const m of v.mismatches.slice(0, 12)) {
        log.error(`  0x${m.off.toString(16).padStart(3, "0")} ${describeOffset(m.off)}: ` +
          `expected 0x${hex(m.expected)}, pedal has 0x${hex(m.actual)}`);
      }
      if (v.mismatches.length > 12) log.error(`  ...and ${v.mismatches.length - 12} more`);
    }
    results.push({ ...it, ...v });
    onProgress({ done: i + 1, total: items.length, label: it.label, ok: v.ok });
    if (i < items.length - 1 && betweenSlotsMs > 0) await sleep(betweenSlotsMs);
  }
  const failed = results.filter((r) => !r.ok);
  const reread = results.filter((r) => r.ok && r.reads > 1);
  const secs = ((performance.now() - started) / 1000).toFixed(1);
  log.info(`Wrote ${results.length} of ${items.length} patch(es) in ${secs} s: ` +
    `${results.length - failed.length} verified, ${failed.length} not verified` +
    (failed.length ? ` (${failed.map((r) => r.label).join(", ")})` : "") +
    (reread.length ? `; ${reread.length} verified only after more than one read-back (${reread.map((r) => r.label).join(", ")})` : ""));
  return { results, failed, cancelled };
}

const hex = (b) => b.toString(16).padStart(2, "0");
