// The Template screen: one .prst written into every slot of a From/To
// range (the CLI's `apply-template`). Two differences from the CLI, both
// agreed with the developer (DESIGN.md, "Designed UI"):
//   - one confirmation for the whole range instead of a y/N per slot;
//   - by default only EMPTY slots (patch name "It's GP-200") are written,
//     every other patch is kept; "every slot" writes them all, as the CLI
//     with --force does.
// The CLI reads each slot's name right before writing it. Here the plan
// comes from the patch list read on connect, and `recheckTemplate` re-reads
// the range just before the write starts, so a patch saved on the pedal in
// the meantime is never overwritten as "empty". The write itself is the
// restore's (upload.js writeSlots): same verify, same pacing.

import { findIrNamDependencies, isPrst, prstFileName, CONTENT_FILE_START } from "./prst.js";
import { readSlots } from "./export.js";
import { slotToLabel } from "./slots.js";

/** The name a slot has when it holds no patch of the user's. Only this
 *  name counts as empty: no other name says a slot is free (developer). */
export const EMPTY_PATCH_NAME = "It's GP-200";

export const isEmptyPatchName = (name) => name === EMPTY_PATCH_NAME;

/**
 * Which slots of `slots` get the template, and which are kept.
 * @param {{name: string, data: Uint8Array}} file the picked .prst
 * @param {number[]} slots the range, in order
 * @param {(slot: number) => string|null|undefined} nameOf current patch name;
 *   null/undefined if it couldn't be read
 * @param {"empty"|"all"} mode
 */
export function planTemplate(file, slots, nameOf, mode = "empty") {
  if (mode !== "empty" && mode !== "all") throw new RangeError(`unknown template mode "${mode}"`);
  if (!isPrst(file.data)) throw new Error(`${file.name} is not a valid .prst file.`);
  const patchName = prstFileName(file.data);
  const irNam = findIrNamDependencies(file.data.subarray(CONTENT_FILE_START));
  const items = [];
  const kept = [];
  const unread = [];
  let empty = 0;
  for (const slot of slots) {
    const label = slotToLabel(slot);
    const current = nameOf(slot) ?? null;
    if (current === null) unread.push(label);
    else if (isEmptyPatchName(current)) empty++;
    // A slot whose name couldn't be read isn't known to be empty, so the
    // default mode keeps it; "every slot" writes it, as the CLI does.
    const write = mode === "all" || isEmptyPatchName(current);
    if (write) items.push({ fileName: file.name, data: file.data, slot, label, patchName, irNam, replaces: current });
    else kept.push({ slot, label, name: current });
  }
  return {
    fileName: file.name, patchName, irNam, mode, slots: [...slots], items, kept, unread,
    counts: { slots: slots.length, empty, users: slots.length - empty - unread.length, write: items.length, keep: kept.length },
  };
}

/** One-line summary for the confirmation and the log. */
export function templateSummary(plan) {
  const c = plan.counts;
  const range = `${slotToLabel(plan.slots[0])} to ${slotToLabel(plan.slots[plan.slots.length - 1])}`;
  const what = `"${plan.patchName}" (${plan.fileName}) into ${range}: ${c.slots} slot(s), ` +
    `${c.empty} empty, ${c.users} with your patches` + (plan.unread.length ? `, ${plan.unread.length} unread` : "");
  if (plan.mode === "all") return `${what}. Every slot in the range: writes ${c.write}.`;
  return `${what}. Empty slots only: writes ${c.write}, keeps ${c.keep}` +
    (c.keep ? ` (${plan.kept.map((k) => k.name === null ? `${k.label} (not read)` : `${k.label} ${k.name}`).join(", ")})` : "") + ".";
}

/** Plain-language warnings to show with the plan, before anything is written. */
export function templateWarnings(plan) {
  const out = [];
  if (!plan.items.length) out.push("Nothing to write: no slot in this range is empty. Choose \"Every slot in the range\" to overwrite them.");
  if (plan.unread.length) {
    out.push(`${plan.unread.length} slot(s) couldn't be read, so it isn't known what they hold: ${plan.unread.join(", ")}. ` +
      (plan.mode === "all" ? "\"Every slot\" overwrites them anyway." : "They are kept."));
  }
  if (plan.irNam.length && plan.items.length) {
    out.push(`This patch uses User-IR/SnapTone (NAM) slots (${plan.irNam.join(", ")}). A patch only stores the slot ` +
      "NUMBER, so it will sound right only if the same IR/NAM is loaded in that same slot on this pedal.");
  }
  return out;
}

/**
 * Re-read the range just before writing and check the plan still holds:
 * every slot to be written must still have the name it was planned with,
 * and in the default mode every kept slot must still not be empty. On a
 * change, nothing should be written; the UI re-plans with the fresh names
 * and asks again.
 * @returns {Promise<{ok: boolean, names: Map<number, string|null>, changed: {label: string, was: string|null, now: string|null}[]}>}
 */
export async function recheckTemplate(device, plan, { skeleton, log }) {
  log.info(`Template: re-reading ${plan.slots.length} slot(s) before writing`);
  const read = await readSlots(device, plan.slots, { skeleton, log });
  const names = new Map(plan.slots.map((s) => [s, null]));
  for (const e of read.entries) names.set(e.slot, e.name);
  const changed = [];
  for (const it of plan.items) {
    const now = names.get(it.slot);
    if (now !== it.replaces) changed.push({ label: it.label, was: it.replaces, now });
  }
  if (plan.mode === "empty") {
    for (const k of plan.kept) {
      const now = names.get(k.slot);
      if (isEmptyPatchName(now) || (k.name === null && now !== null)) changed.push({ label: k.label, was: k.name, now });
    }
  }
  if (changed.length) {
    log.warn(`Template: the pedal changed since its patches were read; nothing written. ` +
      changed.map((c) => `${c.label}: "${c.was ?? "not read"}" -> "${c.now ?? "not read"}"`).join(", "));
  } else {
    log.info("Template: range unchanged since the plan; writing");
  }
  return { ok: changed.length === 0, names, changed };
}
