// Reading every GP-50 slot without selecting any of them (read only).

import { NAME_COUNT } from "./protocol.js";

export const ATTEMPTS = 3;

/**
 * @param {import("./device.js").Gp50Reader} reader
 * @returns entries read ({slot, name, prst}), failed slot numbers, retries,
 *   slots whose name isn't the one in the pedal's list, the selected slot
 *   before and after, and whether the user stopped it
 */
export async function readAllSlots(reader, { log, onProgress = () => {}, isCancelled = () => false, count = NAME_COUNT } = {}) {
  const entries = [];
  const failed = [];
  const wrongName = [];
  let retries = 0;
  let cancelled = false;
  const selectedBefore = await reader.readSlot();
  const names = await reader.readNames();
  for (let slot = 0; slot < count; slot++) {
    if (isCancelled()) {
      cancelled = true;
      log.warn(`Stopped after ${slot} of ${count} slots`);
      break;
    }
    let patch = null;
    for (let attempt = 1; attempt <= ATTEMPTS && !patch; attempt++) {
      try {
        patch = await reader.readSlotPatch(slot);
        // The reply doesn't say which slot it is; the name is the check.
        if (patch.name !== names[slot] && attempt < ATTEMPTS) {
          log.warn(`Slot ${slot} came back as "${patch.name}", the list says "${names[slot]}"; reading again`);
          patch = null;
          retries++;
        }
      } catch (err) {
        log.warn(`Slot ${slot}, attempt ${attempt} of ${ATTEMPTS}: ${err.message}`);
        if (attempt < ATTEMPTS) retries++;
      }
    }
    if (!patch) {
      failed.push(slot);
      log.error(`Slot ${slot} couldn't be read`);
    } else {
      if (patch.name !== names[slot]) wrongName.push(slot);
      entries.push({ slot, ...patch });
    }
    onProgress(slot + 1, count);
  }
  // Not worth losing the patches over if the pedal has gone.
  const selectedAfter = await reader.readSlot().catch(() => null);
  return { entries, failed, wrongName, retries, cancelled, selectedBefore, selectedAfter };
}

/**
 * "51-STD AC.prst", as Valeton Suite names its exports, except that Suite
 * drops punctuation ("35-GnR DST.prst" for "Gn'R DST") and this keeps it.
 */
export function slotFileName(slot, name) {
  const safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "");
  return `${String(slot).padStart(2, "0")}-${safe || "unnamed"}.prst`;
}

/** Groups of two or more slots whose patches (name included) are identical. */
export function identicalGroups(entries) {
  const groups = new Map();
  for (const { slot, prst } of entries) {
    const key = prst.join();
    groups.set(key, [...(groups.get(key) ?? []), slot]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** [0,1,2,5] -> "0-2, 5" */
export function slotRanges(slots) {
  const runs = [];
  for (const s of slots) {
    const last = runs[runs.length - 1];
    if (last && s === last[1] + 1) last[1] = s;
    else runs.push([s, s]);
  }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");
}
