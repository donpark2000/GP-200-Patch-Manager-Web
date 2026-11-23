// Restoring GP-50 patches: files -> which patch goes where -> write and read
// back each one. No DOM code. Ordering and placement follow the GP-200 app's
// restore (src/core/upload.js): by leading number if every file has one,
// else alphabetical; consecutive slots; a file that can't be used keeps its
// position and that slot is left unchanged.

import { expandSources } from "../src/core/upload.js";
import { diffOffsets, NAME_COUNT } from "./protocol.js";
import { assertPrst } from "./write-protocol.js";

/** Which pedal a .prst is for, by its first bytes, never its name. */
export function fileKind(data) {
  const starts = (text) => text.split("").every((c, i) => data[i] === c.charCodeAt(0));
  if (starts("TSRP")) return "GP-200";
  if (starts("GP-50\0")) return "GP-50";
  return null;
}

/** Why this file can't go on a GP-50, or null. */
export function fileProblem(data) {
  const kind = fileKind(data);
  if (kind === "GP-200") return "this is a GP-200 patch, and the pedal is a GP-50";
  if (!kind) return "not a GP-50 patch file";
  try {
    assertPrst(data);
    return null;
  } catch (err) {
    return err.message;
  }
}

const leadingNumber = (fileName) => {
  const m = /^(\d\d)(?=[-_ ])/.exec(fileName.split(/[\/]/).pop());
  return m ? Number(m[1]) : null;
};

export function orderPatches(entries) {
  const numbers = entries.map((e) => leadingNumber(e.name));
  const numbered = numbers.every((n) => n !== null);
  const key = (e, i) => (numbered ? numbers[i] : e.name.toLowerCase());
  const keyed = entries.map((e, i) => ({ e, k: key(e, i) }));
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)); // stable
  return { ordered: keyed.map((x) => x.e), orderedBy: numbered ? "patch number" : "file name (not every name starts with a patch number)" };
}

/**
 * @param {{name: string, data: Uint8Array}[]} files .prst files, or one .zip
 * @param {number} start
 */
export async function planRestore(files, start) {
  if (!Number.isInteger(start) || start < 0 || start >= NAME_COUNT) throw new Error(`"${start}" isn't a patch from 0 to ${NAME_COUNT - 1}`);
  const { entries, notes } = await expandSources(files);
  const { ordered, orderedBy } = orderPatches(entries);
  const items = [];
  const skipped = [];
  const overflow = [];
  ordered.forEach(({ name, data }, i) => {
    const slot = start + i;
    if (slot >= NAME_COUNT) {
      overflow.push(name);
      return;
    }
    const problem = fileProblem(data);
    if (problem) skipped.push({ fileName: name, slot, reason: `${problem}; patch ${slot} is left unchanged` });
    else items.push({ fileName: name, slot, prst: data });
  });
  return { items, skipped, overflow, orderedBy, notes };
}

export const describeDiff = (offsets) =>
  `${offsets.length} bytes, at ${offsets.slice(0, 20).map((i) => `0x${i.toString(16)}`).join(", ")}${offsets.length > 20 ? ", ..." : ""}`;

/**
 * Writes each patch and reads it back; stops at the first problem.
 * @param {import("./writer.js").Gp50Writer} writer
 * @param {{slot: number, prst: Uint8Array}[]} items
 * @param {object} opts
 * @param {(found: {slot: number, selected: number, now: {name: string, prst: Uint8Array}}) => void} [opts.guard]
 *   throws if what the slot holds now mustn't be overwritten
 * @param {Set<number>} [opts.touched] every slot a write was begun on is added
 */
export async function writePatches(writer, items, { log, confirmed = false, guard = () => {}, touched = new Set(), onProgress = () => {}, isCancelled = () => false } = {}) {
  const out = { total: items.length, written: [], verified: [], restarted: [], cancelled: false, problem: null, selectedBefore: null, selectedAfter: null };
  try {
    if (confirmed !== true) throw new Error("Refused: the write wasn't confirmed");
    for (const { slot, prst } of items) {
      if (isCancelled()) {
        out.cancelled = true;
        log.warn(`Stopped after ${out.verified.length} of ${items.length} patches`);
        break;
      }
      const selected = await writer.readSlot();
      out.selectedBefore ??= selected;
      guard({ slot, selected, now: await writer.readSlotPatch(slot) });
      // Counted from the first frame: a write that fails may have changed the slot.
      out.written.push(slot);
      touched.add(slot);
      const { attempts } = await writer.writeSlotPatch(slot, prst, { confirmed });
      if (attempts > 1) out.restarted.push(slot);
      const problem = await verify(writer, slot, prst, log);
      if (problem) throw new Error(problem);
      out.verified.push(slot);
      onProgress(out.verified.length, items.length);
    }
  } catch (err) {
    out.problem = err.message;
    log.error(`Stopped: ${err.message}`);
  }
  if (out.selectedBefore !== null) out.selectedAfter = await writer.readSlot().catch(() => null);
  return out;
}

// A difference stops the run either way; reading it three more times tells
// a stored difference from a read that changes.
async function verify(reader, slot, want, log) {
  const first = diffOffsets((await reader.readSlotPatch(slot)).prst, want);
  if (!first.length) return null;
  log.warn(`Slot ${slot} read back different: ${describeDiff(first)}`);
  const seen = new Set([first.join()]);
  for (let i = 0; i < 3; i++) {
    const again = diffOffsets((await reader.readSlotPatch(slot)).prst, want);
    log.warn(`Slot ${slot} read again: ${again.length ? describeDiff(again) : "as written"}`);
    seen.add(again.join());
  }
  return `Slot ${slot} read back different from what was written (${describeDiff(first)}); ${seen.size === 1 ? "the same in 4 reads" : "it changed between reads"}`;
}
