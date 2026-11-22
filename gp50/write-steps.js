// The GP-50 write test's steps (DEV_JOURNAL.md, 2026-11-22). No DOM code.

import { readAllSlots, slotRanges } from "./backup.js";
import { diffOffsets, NAME_COUNT } from "./protocol.js";
import { assertPrst, mayWrite, WRITE_FIRST, WRITE_LAST } from "./write-protocol.js";

/** "US Lead", byte for byte the patch in the captured Suite write. */
export const FIRST_SOURCE = 15;
export const FIRST_TARGET = 99;

const writable = Array.from({ length: WRITE_LAST - WRITE_FIRST + 1 }, (_, i) => WRITE_FIRST + i);

/**
 * Each stage: what it writes (target slot, whose patch by reference slot) and
 * so what the pedal should hold afterwards.
 */
export const STAGES = Object.freeze({
  first: { label: `slot ${FIRST_SOURCE}'s patch in slot ${FIRST_TARGET}`, map: [[FIRST_TARGET, FIRST_SOURCE]] },
  copy: { label: `slots 0-${WRITE_LAST - WRITE_FIRST} copied into ${WRITE_FIRST}-${WRITE_LAST}`, map: writable.map((s) => [s, s - WRITE_FIRST]) },
  reference: { label: "the same as the reference zip", map: writable.map((s) => [s, s]) },
});

/**
 * The reference: a complete zip from the read-only page.
 * @param {Map<string, Uint8Array>} files
 * @returns {Uint8Array[]} the patch of each slot, 0-99
 */
export function parseReference(files) {
  const slots = [];
  for (const [name, data] of files) {
    const m = /^(\d\d)-.*\.prst$/.exec(name);
    if (!m) throw new Error(`"${name}" isn't named like a slot's patch`);
    const slot = Number(m[1]);
    if (slots[slot]) throw new Error(`Two files for slot ${slot}`);
    try {
      assertPrst(data);
    } catch (err) {
      throw new Error(`${name}: ${err.message}`);
    }
    slots[slot] = data;
  }
  const missing = Array.from({ length: NAME_COUNT }, (_, i) => i).filter((i) => !slots[i]);
  if (missing.length) throw new Error(`The zip has no patch for slots ${slotRanges(missing)}`);
  return slots;
}

/** What slots 0-99 should hold after a stage. */
export function expectedAfter(stage, reference) {
  const all = [...reference];
  for (const [target, source] of STAGES[stage].map) all[target] = reference[source];
  return all;
}

/** Reads all 100 slots and compares them with what's expected. `pass` needs every slot read and equal. */
export async function checkAll(reader, expected, opts) {
  const result = await readAllSlots(reader, opts);
  const differing = result.entries
    .map(({ slot, name, prst }) => ({ slot, name, offsets: diffOffsets(prst, expected[slot]) }))
    .filter((d) => d.offsets.length);
  const compared = result.entries.length;
  const pass = compared === NAME_COUNT && !differing.length && !result.wrongName.length && !result.cancelled;
  return { ...result, compared, differing, pass };
}

export const describeDiff = (offsets) =>
  `${offsets.length} bytes, at ${offsets.slice(0, 20).map((i) => `0x${i.toString(16)}`).join(", ")}${offsets.length > 20 ? ", ..." : ""}`;

/**
 * Writes a stage's patches, each read back and compared. Stops at the first
 * problem. A slot is written only if what it holds now is in the reference
 * or this page put it there (`touched`), so nothing can be lost, and only
 * while none of 55-99 is selected on the pedal (what a write does to the
 * selected patch isn't known).
 * @param {import("./writer.js").Gp50Writer} writer
 */
export async function runStage(writer, stage, reference, { log, confirmed = false, touched = new Set(), onProgress = () => {}, isCancelled = () => false } = {}) {
  const { map } = STAGES[stage];
  const known = new Set(reference.map((p) => p.join()));
  const out = { total: map.length, written: [], verified: [], cancelled: false, problem: null, selectedBefore: null, selectedAfter: null };
  try {
    if (confirmed !== true) throw new Error("Refused: the write wasn't confirmed");
    for (const [target, source] of map) {
      if (isCancelled()) {
        out.cancelled = true;
        log.warn(`Stopped after ${out.verified.length} of ${map.length} patches`);
        break;
      }
      const selected = await writer.readSlot();
      out.selectedBefore ??= selected;
      if (mayWrite(selected)) throw new Error(`The pedal is on slot ${selected}; select one from 0 to ${WRITE_FIRST - 1} on the pedal first`);
      const now = await writer.readSlotPatch(target);
      if (!known.has(now.prst.join()) && !touched.has(target)) throw new Error(`Slot ${target} holds "${now.name}", which isn't in the reference zip; it wasn't overwritten`);
      // Counted from the first frame: a write that fails may have changed the slot.
      out.written.push(target);
      touched.add(target);
      await writer.writeSlotPatch(target, reference[source], { confirmed });
      const problem = await verify(writer, target, reference[source], log);
      if (problem) throw new Error(problem);
      out.verified.push(target);
      onProgress(out.verified.length, map.length);
    }
  } catch (err) {
    out.problem = err.message;
    log.error(`Stopped: ${err.message}`);
  }
  if (out.selectedBefore !== null) out.selectedAfter = await writer.readSlot().catch(() => null);
  return out;
}

// A difference stops the test either way; reading it three more times tells
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
