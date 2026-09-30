// Slot numbering: 256 slots, shown on the pedal as banks 1-64 x A-D.
// Ported from gp200.py (slot_to_label, label_to_slot, parse_slot_range).

export const TOTAL_SLOTS = 256;

export function slotToLabel(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= TOTAL_SLOTS) {
    throw new RangeError(`slot ${slot} out of range 0-${TOTAL_SLOTS - 1}`);
  }
  return `${Math.floor(slot / 4) + 1}${"ABCD"[slot % 4]}`;
}

/** Accepts "34B", "34-B", " 34b ". */
export function labelToSlot(label) {
  const s = String(label).trim().toUpperCase().replace(/-/g, "");
  const m = /^(\d+)([ABCD])$/.exec(s);
  if (!m) throw new RangeError(`invalid slot label "${label}"; expected e.g. 34B or 34-B`);
  const slot = (Number(m[1]) - 1) * 4 + "ABCD".indexOf(m[2]);
  if (slot < 0 || slot >= TOTAL_SLOTS) {
    throw new RangeError(`slot label "${label}" is out of range (banks 1-64, A-D)`);
  }
  return slot;
}

/** Inclusive range of slot indices, in natural pedal order. */
export function parseSlotRange(startLabel, endLabel) {
  const a = labelToSlot(startLabel);
  const b = labelToSlot(endLabel);
  if (a > b) throw new RangeError(`${startLabel} comes after ${endLabel}`);
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
