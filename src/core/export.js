// Backing up slots: read each one, build its .prst, package the result.
// Mirrors the CLI's `export` (single slot, range, or all), including its file
// names and its gap / User-IR-NAM warnings.

import { ReadError } from "./device.js";
import { exportFileName, exportPrst, extractNameField, findIrNamDependencies } from "./prst.js";
import { chunkOffset, chunkPayload } from "./sysex.js";
import { slotToLabel, TOTAL_SLOTS } from "./slots.js";
import { createZip } from "./zip.js";

/**
 * Read `slots` in order and build an export file for each.
 * @param {import("./device.js").GP200} device
 * @param {number[]} slots
 * @param {object} opts
 * @param {Uint8Array} opts.skeleton
 * @param {import("./log.js").Logger} opts.log
 * @param {(p: {done: number, total: number, label: string, name: string|null}) => void} [opts.onProgress]
 * @param {() => boolean} [opts.isCancelled]
 */
export async function readSlots(device, slots, { skeleton, log, onProgress = () => {}, isCancelled = () => false }) {
  const entries = [];
  const skipped = [];
  const irNam = [];
  const dumpLengths = new Map();
  let reread = 0;
  let cancelled = false;
  const started = performance.now();

  for (let i = 0; i < slots.length; i++) {
    if (isCancelled()) {
      cancelled = true;
      log.warn(`Cancelled after ${i} of ${slots.length} slots`);
      break;
    }
    const slot = slots[i];
    const label = slotToLabel(slot);
    let r;
    try {
      r = await device.readDump(slot);
    } catch (e) {
      if (!(e instanceof ReadError)) throw e;
      log.error(`Error reading ${label} - skipped (${e.reason})`);
      skipped.push(label);
      onProgress({ done: i + 1, total: slots.length, label, name: null });
      continue;
    }
    if (entries.length === 0) {
      // Record the real message structure once per run: the CLI never
      // logged it, so the first hardware run through the browser fills in
      // facts the JS port currently only assumes (DEV_JOURNAL.md).
      const shape = r.chunks
        .map((m) => `${chunkOffset(m)}:${chunkPayload(m).length}`)
        .join(", ");
      log.info(`First read (${label}): ${r.chunks.length} chunks as offset:nibbles [${shape}], ` +
        `${r.decoded.length} decoded bytes, ${r.ms.toFixed(0)} ms`);
    }
    if (r.attempt > 1) reread++;
    dumpLengths.set(r.decoded.length, (dumpLengths.get(r.decoded.length) ?? 0) + 1);

    const name = extractNameField(r.decoded);
    const deps = findIrNamDependencies(r.decoded);
    if (deps.length) irNam.push({ label, deps });
    entries.push({ slot, label, name, fileName: exportFileName(slot, r.decoded), data: exportPrst(r.decoded, skeleton) });
    onProgress({ done: i + 1, total: slots.length, label, name });
  }

  const elapsedMs = performance.now() - started;
  const attempted = entries.length + skipped.length;
  log.info(`Read ${entries.length} of ${slots.length} slots in ${(elapsedMs / 1000).toFixed(1)} s` +
    (attempted ? ` (${(elapsedMs / attempted).toFixed(0)} ms per slot)` : "") +
    `; ${reread} needed a re-read, ${skipped.length} skipped`);
  if (dumpLengths.size > 1) {
    log.warn(`Dump lengths varied between slots: ${[...dumpLengths].map(([n, c]) => `${n} bytes x${c}`).join(", ")}`);
  }
  return { entries, skipped, irNam, cancelled, elapsedMs };
}

/**
 * The patch list the designed UI shows: every slot's name, read on connect
 * and after any write. The same read as an export (about 0.3 s for all
 * 256), keeping only the names.
 * @returns {Promise<{names: (string|null)[], skipped: string[], cancelled: boolean}>}
 *   names[slot]; null where the slot couldn't be read
 */
export async function readPatchList(device, { skeleton, log, onProgress, isCancelled }) {
  log.info("Reading the patch list (all 256 slots)");
  const result = await readSlots(device, Array.from({ length: TOTAL_SLOTS }, (_, i) => i),
    { skeleton, log, onProgress, isCancelled });
  const names = new Array(TOTAL_SLOTS).fill(null);
  for (const e of result.entries) names[e.slot] = e.name;
  return { names, skipped: result.skipped, cancelled: result.cancelled };
}

/** File name for a multi-slot export, as the CLI names it. */
export function zipFileName(slots) {
  const isAll = slots.length === TOTAL_SLOTS && slots.every((s, i) => s === i);
  if (isAll) return "gp200_all_patches.zip";
  return `gp200_${slotToLabel(slots[0])}_to_${slotToLabel(slots[slots.length - 1])}.zip`;
}

/**
 * Package a readSlots result for download: one slot gives a bare .prst,
 * anything else a zip.
 * @returns {{fileName: string, bytes: Uint8Array} | null} null if nothing was read
 */
export function packageExport(slots, result) {
  if (result.entries.length === 0) return null;
  if (slots.length === 1) {
    const e = result.entries[0];
    return { fileName: e.fileName, bytes: e.data };
  }
  return {
    fileName: zipFileName(slots),
    bytes: createZip(result.entries.map((e) => ({ name: e.fileName, data: e.data }))),
  };
}

/** Plain-language warnings to show after an export (same content as the CLI's). */
export function exportWarnings(result) {
  const out = [];
  if (result.skipped.length) {
    out.push(`${result.skipped.length} slot(s) were skipped and are NOT in this backup: ` +
      `${result.skipped.join(", ")}. Restoring a zip fills slots one after another, so a gap is ` +
      "not preserved: every patch after it would land one slot earlier than where it came from. " +
      "Export again to fill the gap before using this backup to restore.");
  }
  if (result.irNam.length) {
    const refs = result.irNam.reduce((n, x) => n + x.deps.length, 0);
    out.push(`${result.irNam.length} patch(es) reference ${refs} User-IR/SnapTone (NAM) slot(s). ` +
      "This backup only stores WHICH slot, not the IR/NAM content itself: " +
      result.irNam.map((x) => `${x.label}: ${x.deps.join(", ")}`).join("; ") +
      ". Restoring these on a different pedal, or after that slot has been reloaded with " +
      "something else, will sound different, with no warning either way.");
  }
  return out;
}
