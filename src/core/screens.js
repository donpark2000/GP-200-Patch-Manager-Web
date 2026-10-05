// What the designed UI's screens say, worked out without the DOM so it can be
// tested in Node: range parsing in the "12-A" style, the summaries next to
// each button, and the restore/template "After" view of the patch list.
// The UI (src/ui/app.js) only renders what these return.

import { safeFilename } from "./prst.js";
import { labelToSlot, slotToDisplayLabel, slotToLabel, TOTAL_SLOTS } from "./slots.js";
import { isEmptyPatchName } from "./template.js";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One slot box: blank allowed (gives `blank`), else a slot or an error. */
function parseBox(text, what, blank) {
  const t = String(text ?? "").trim();
  if (!t) return { slot: blank };
  try {
    return { slot: labelToSlot(t) };
  } catch {
    return { error: `${what} isn't a slot (e.g. 12-A)` };
  }
}

/**
 * From/To boxes -> the slots between them. A blank From means 1-A, a blank
 * To 64-D (as the test page and slotsBetween do), so both blank is all 256.
 * @returns {{slots: number[]} | {error: string}}
 */
export function parseRange(fromText, toText) {
  const a = parseBox(fromText, "From", 0);
  if (a.error) return a;
  const b = parseBox(toText, "To", TOTAL_SLOTS - 1);
  if (b.error) return b;
  if (a.slot > b.slot) return { error: `${slotToDisplayLabel(a.slot)} comes after ${slotToDisplayLabel(b.slot)}` };
  return { slots: Array.from({ length: b.slot - a.slot + 1 }, (_, i) => a.slot + i) };
}

/** The Restore screen's start box; blank is an error here (no sensible default). */
export function parseStart(text) {
  if (!String(text ?? "").trim()) return { error: "Enter a start slot (e.g. 34-A)" };
  const r = parseBox(text, "Start", null);
  return r.error ? { error: "Start isn't a slot (e.g. 34-A)" } : r;
}

const rangeText = (slots) => `${slotToDisplayLabel(slots[0])} to ${slotToDisplayLabel(slots[slots.length - 1])}`;

/** File the backup will save, as export.js will name it. One slot's name
 *  comes from the read, so the list's name is the best guess beforehand. */
export function backupFileName(slots, nameOf) {
  if (slots.length === TOTAL_SLOTS) return "gp200_all_patches.zip";
  if (slots.length > 1) return `gp200_${slotToLabel(slots[0])}_to_${slotToLabel(slots[slots.length - 1])}.zip`;
  const name = nameOf(slots[0]);
  return name == null ? `${slotToLabel(slots[0])}_<name>.prst` : `${slotToLabel(slots[0])}_${safeFilename(name || slotToLabel(slots[0]))}.prst`;
}

/** "3 slots: 12-A to 12-C, saved as gp200_12A_to_12C.zip" */
export function backupSummary(slots, nameOf) {
  const what = slots.length === TOTAL_SLOTS ? "All 256 slots" : plural(slots.length, "slot");
  return `${what}: ${rangeText(slots)}, saved as ${backupFileName(slots, nameOf)}`;
}

/** Counts of what a restore or template write replaces, from the list's names. */
export function replaceCounts(slots, nameOf) {
  let yours = 0;
  let empty = 0;
  let unknown = 0;
  for (const s of slots) {
    const n = nameOf(s);
    if (n == null) unknown++;
    else if (isEmptyPatchName(n)) empty++;
    else yours++;
  }
  return { yours, empty, unknown };
}

function replacingText({ yours, empty, unknown }) {
  const parts = [];
  if (yours) parts.push(`${yours} of your patches`);
  if (empty) parts.push(plural(empty, "empty slot"));
  if (unknown) parts.push(`${plural(unknown, "slot")} not read`);
  return parts.length ? parts.join(", ") : "nothing";
}

/**
 * The Restore screen's summary line for an upload.js plan.
 * @returns {{text: string, overflowText: string|null}}
 */
export function restoreSummary(plan, nameOf) {
  const slots = plan.items.map((it) => it.slot);
  if (!slots.length) return { text: "Nothing to write.", overflowText: overflowText(plan) };
  const counts = replaceCounts(slots, nameOf);
  return {
    text: `${plural(slots.length, "file")} go to ${rangeText(slots)}, replacing ${replacingText(counts)}. ` +
      "Hover a slot to see which file goes there.",
    overflowText: overflowText(plan),
  };
}

function overflowText(plan) {
  const n = plan.overflow.length;
  return n ? `${plural(n, "file")} ${n === 1 ? "doesn't" : "don't"} fit after 64-D and won't be written.` : null;
}

/** Confirmation text for a restore. */
/** Ends both write confirmations (developer, 2026-10-05: the one moment a
 *  backup reminder matters). */
export const BACKUP_FIRST = "If you haven't already, back up these slots first (Back up screen).";

export function restoreConfirmText(plan, nameOf) {
  const slots = plan.items.map((it) => it.slot);
  const counts = replaceCounts(slots, nameOf);
  return `Write ${plural(slots.length, "patch", "patches")} to ${rangeText(slots)}? ` +
    `This replaces ${replacingText(counts)}. ${BACKUP_FIRST}`;
}

/** Template summary for the screen (display labels; templateSummary in
 *  template.js is the log's version). */
export function templateScreenSummary(plan) {
  const c = plan.counts;
  const parts = [];
  if (c.empty) parts.push(`${c.empty} empty`);
  if (c.users) parts.push(`${c.users} of your patches`);
  if (plan.unread.length) parts.push(`${plan.unread.length} not read`);
  let text = `${plural(c.slots, "slot")}, ${rangeText(plan.slots)} (${parts.join(", ")}). `;
  if (!c.write) return { text: text + "Nothing to write.", yoursWritten: 0 };
  const yoursWritten = plan.items.filter((it) => it.replaces !== null && !isEmptyPatchName(it.replaces)).length;
  text += `Writes ${c.write}` + (yoursWritten ? `, ${yoursWritten} of them your own patches` : "") + ".";
  if (c.keep) {
    const shown = plan.kept.slice(0, 6).map((k) => `${slotToDisplayLabel(k.slot)} ${k.name ?? "(not read)"}`);
    text += ` Keeps ${c.keep}: ${shown.join(", ")}${c.keep > 6 ? `, and ${c.keep - 6} more` : ""}.`;
  }
  return { text, yoursWritten };
}

/** Confirmation text for a template write. */
export function templateConfirmText(plan) {
  const { yoursWritten } = templateScreenSummary(plan);
  return `Write ${plan.fileName} to ${plural(plan.items.length, "slot")} between ` +
    `${slotToDisplayLabel(plan.slots[0])} and ${slotToDisplayLabel(plan.slots[plan.slots.length - 1])}?` +
    (yoursWritten ? ` ${yoursWritten} of them ${yoursWritten === 1 ? "holds" : "hold"} your own patches.` : "") +
    (plan.counts.keep ? ` ${plan.counts.keep} kept.` : "") + ` ${BACKUP_FIRST}`;
}

/** slot -> name each written slot will have afterwards ("After" view). */
export function afterNames(items) {
  return new Map(items.map((it) => [it.slot, it.patchName]));
}

const PEDAL_SCREENS = ["backup", "restore", "template"];

/**
 * The screen to show once the pedal is connected (developer, 2026-10-02):
 * Back up, except after a lost connection, when the user returns to the
 * pedal screen they were on (so a reconnect mid-restore doesn't move them).
 * @param {string} current the screen showing now ("home", "backup", ...)
 * @param {boolean} wasConnected the pedal was connected earlier this visit
 */
export function screenAfterConnect(current, wasConnected) {
  return wasConnected && PEDAL_SCREENS.includes(current) ? current : "backup";
}

/**
 * A click on the patch list for a From/To range: the first click sets both
 * ends to that patch, the second sets the other end, in either direction.
 * @param {number|undefined} from the slot now in From (undefined if none)
 * @param {"from"|"to"} next which end this click sets
 * @param {number} slot the patch clicked
 * @returns {{from: number, to: number, next: "from"|"to"}}
 */
export function clickRange(from, next, slot) {
  if (next === "from" || from === undefined) return { from: slot, to: slot, next: "to" };
  return { from: Math.min(from, slot), to: Math.max(from, slot), next: "from" };
}

/**
 * Dragging across the patch list (developer, 2026-10-05): the range runs
 * from the patch where the drag started to the one under the pointer, in
 * either direction.
 */
export function dragRange(anchor, slot) {
  return { from: Math.min(anchor, slot), to: Math.max(anchor, slot) };
}

/**
 * How the Template screen marks the list (developer, 2026-10-05): the range
 * as on Back up ("sel"); once there is a plan, the slots it will write are
 * "over" (orange, as on Restore) and the kept ones stay "sel".
 * @param {number[]|undefined} slots the range in the From/To boxes
 * @param {{items: {slot: number}[]}|undefined} plan
 * @returns {Map<number, "sel"|"over">}
 */
export function templateMarks(slots, plan) {
  const marks = new Map((slots ?? []).map((s) => [s, "sel"]));
  for (const it of plan?.items ?? []) marks.set(it.slot, "over");
  return marks;
}
