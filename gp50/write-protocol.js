// The GP-50 patch write and its safety gate. Used only by the write test
// (write.html); the read-only page doesn't load it (tests/gp50-write.test.js).
// CLAUDE.md allows writes to slots 55-99 only, after confirmation in the app.
//
// Message (facts from drewmerc302/valeton-gp50, MIT, (c) 2026 Andrew
// Mercurio; a real Suite write is the test fixture):
//   payload = [0x11, 0x4f, slot, 0, 0, 0] + the .prst from 0x19 (name, body)
//   in 29 frames of up to 19 bytes, each acknowledged by 14 08 00

import { crc8, diffOffsets, frameToWire, parseFrame, PRST_LEN, toHex } from "./protocol.js";

export const KIND_WRITE = 0x11;
export const WRITE_PATCH = 0x4f;
export const WRITE_FIRST = 55;
export const WRITE_LAST = 99;
export const ACK = Object.freeze([0x14, 0x08, 0x00]);

const NAME_OFF = 0x19;
const FRAME_LEN = 19;
const PAYLOAD_LEN = 6 + PRST_LEN - NAME_OFF;
export const FRAME_COUNT = Math.ceil(PAYLOAD_LEN / FRAME_LEN);

export const mayWrite = (slot) => Number.isInteger(slot) && slot >= WRITE_FIRST && slot <= WRITE_LAST;

function assertWritable(slot) {
  if (!mayWrite(slot)) throw new Error(`Refused: slot ${slot} isn't one of ${WRITE_FIRST}-${WRITE_LAST}, the only slots this test may write`);
}

/** Throws unless `prst` is a complete, undamaged GP-50 patch file. */
export function assertPrst(prst) {
  if (prst.length !== PRST_LEN) throw new Error(`Not a GP-50 patch: ${prst.length} bytes, expected ${PRST_LEN}`);
  if (String.fromCharCode(...prst.slice(0, 6)) !== "GP-50\0") throw new Error(`Not a GP-50 patch: it starts ${toHex(prst.slice(0, 6))}`);
  if (Array.from(prst.slice(0x15, 0x19)).some((b) => b !== 0xff)) throw new Error("Not a GP-50 patch as exported: no ff ff ff ff at 0x15");
  const want = crc8(prst.slice(0x15));
  if (prst[0x14] !== want) throw new Error(`Damaged patch: CRC 0x${toHex([prst[0x14]])}, computed 0x${toHex([want])}`);
}

const writePayload = (slot, prst) => [KIND_WRITE, WRITE_PATCH, slot, 0, 0, 0, ...prst.slice(NAME_OFF)];
const framePayload = (payload, i) => payload.slice(i * FRAME_LEN, (i + 1) * FRAME_LEN);

/** The write as Suite sends it, for any slot. The gate lets only slots 55-99 be sent. */
export function encodePatchWrite(slot, prst) {
  assertPrst(prst);
  const payload = writePayload(slot, prst);
  return Array.from({ length: FRAME_COUNT }, (_, i) => frameToWire(FRAME_COUNT, i, framePayload(payload, i)));
}

export function buildPatchWrite(slot, prst) {
  assertWritable(slot);
  return encodePatchWrite(slot, prst);
}

/**
 * The safety gate: made for writing one patch to one slot, it passes each of
 * that write's frames once, in order, and nothing else. After refusing
 * anything it passes nothing more.
 */
export class WriteGate {
  constructor(slot, prst) {
    assertWritable(slot);
    assertPrst(prst);
    this.slot = slot;
    this.payload = writePayload(slot, prst);
    this.next = 0;
    this.closed = false;
  }

  check(msg) {
    const problem = this._problem(msg);
    if (problem) {
      this.closed = true;
      throw new Error(`Refused to send (${problem}): ${toHex(msg)}`);
    }
    this.next++;
  }

  _problem(msg) {
    if (this.closed) return "this write was already refused";
    if (this.next >= FRAME_COUNT) return "this write is already complete";
    const f = parseFrame(msg);
    if (!f.ok) return f.problem;
    if (f.total !== FRAME_COUNT || f.index !== this.next) return `frame ${f.index} of ${f.total}, expected ${this.next} of ${FRAME_COUNT}`;
    if (diffOffsets(framePayload(this.payload, f.index), f.payload).length) return `not this patch for slot ${this.slot}`;
    return null;
  }
}
