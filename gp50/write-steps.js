// The GP-50 write test's steps (DEV_JOURNAL.md, 2026-11-22). No DOM code.

import { readAllSlots, slotRanges } from "./backup.js";
import { diffOffsets, NAME_COUNT } from "./protocol.js";
import { writePatches } from "./restore.js";
import { assertPrst } from "./write-protocol.js";

/** "US Lead", byte for byte the patch in the captured Suite write. */
export const FIRST_SOURCE = 15;
export const FIRST_TARGET = 99;

/** The test's layout: 0-44 are copied into these (its empty patches). */
const WRITE_FIRST = 55, WRITE_LAST = 99;
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

/**
 * Writes a stage's patches, each read back and compared. Stops at the first
 * problem. A slot is written only if what it holds now is in the reference
 * or this page put it there (`touched`), so nothing can be lost, and only
 * while the pedal isn't on a slot this stage writes (what a write does to the
 * selected patch wasn't known when this was built).
 * @param {import("./writer.js").Gp50Writer} writer
 */
export async function runStage(writer, stage, reference, { touched = new Set(), ...opts } = {}) {
  const items = STAGES[stage].map.map(([slot, source]) => ({ slot, prst: reference[source] }));
  const inReference = onlyKnown(reference, touched);
  const targets = new Set(items.map((i) => i.slot));
  const guard = (found) => {
    if (targets.has(found.selected)) throw new Error(`The pedal is on slot ${found.selected}, which this step writes; select another on the pedal first`);
    inReference(found);
  };
  return writePatches(writer, items, { ...opts, touched, guard });
}

/** A guard for writePatches: overwrite only what is in `reference`, or what this run wrote. */
export function onlyKnown(reference, touched = new Set()) {
  const known = new Set(reference.map((p) => p.join()));
  return ({ slot, now }) => {
    if (!known.has(now.prst.join()) && !touched.has(slot)) throw new Error(`Slot ${slot} holds "${now.name}", which isn't in the reference zip; it wasn't overwritten`);
  };
}
