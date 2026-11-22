// GP-50 messages and .prst layout. Experiment, READ ONLY (DEV_JOURNAL.md,
// 2026-11-22); separate from the GP-200 app and never published.
//
// Facts from drewmerc302/valeton-gp50 (MIT, (c) 2026 Andrew Mercurio) and
// grzmol/VLTN-Tone-Studio (GPL-3.0), not yet confirmed on our pedal:
//   frame   = [crc, total, index, len, ...payload], payload up to 19 bytes
//   crc     = CRC-8, poly 0x07, over the frame after the crc byte
//   on wire = F0, each byte as two nibbles (high first), F7
//   payload = [kind, function, ...]; kind 0x12 reads, kind 0x11 CHANGES the pedal

export const KIND_READ = 0x12;

/** The only functions this experiment may ask for. All are plain reads with no arguments. */
export const READS = Object.freeze({ settings: 0x10, names: 0x40, patch: 0x41, slot: 0x43 });

export const BODY_LEN = 511;
export const PRST_LEN = 552;
export const NAME_COUNT = 100;
const NAME_LEN = 16;
// 0x00-0x13 of every GP-50 .prst seen so far.
const PRST_HEAD = [0x47, 0x50, 0x2d, 0x35, 0x30, ...new Array(13).fill(0), 0x01, 0x00];

export function crc8(bytes) {
  let c = 0;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c & 0x80 ? (c << 1) ^ 0x07 : c << 1) & 0xff;
  }
  return c;
}

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");

export function frameToWire(total, index, payload) {
  const rest = [total, index, payload.length, ...payload];
  const frame = [crc8(rest), ...rest];
  return Uint8Array.from([0xf0, ...frame.flatMap((b) => [b >> 4, b & 0x0f]), 0xf7]);
}

/** @returns {{ok: true, total: number, index: number, payload: number[]} | {ok: false, problem: string}} */
export function parseFrame(message) {
  const msg = Array.from(message);
  const bad = (problem) => ({ ok: false, problem });
  if (msg.length < 2 || msg[0] !== 0xf0 || msg[msg.length - 1] !== 0xf7) return bad("not a complete F0...F7 message");
  const nib = msg.slice(1, -1);
  if (nib.some((b) => b > 0x0f)) return bad("not split into nibbles");
  if (nib.length % 2 || nib.length < 8) return bad(`${nib.length} nibbles, expected an even number, at least 8`);
  const f = [];
  for (let i = 0; i < nib.length; i += 2) f.push((nib[i] << 4) | nib[i + 1]);
  const want = crc8(f.slice(1));
  if (f[0] !== want) return bad(`CRC 0x${toHex([f[0]])}, computed 0x${toHex([want])}`);
  const payload = f.slice(4);
  if (payload.length !== f[3]) return bad(`length byte ${f[3]}, payload ${payload.length}`);
  if (f[2] >= f[1]) return bad(`frame index ${f[2]} of ${f[1]}`);
  return { ok: true, total: f[1], index: f[2], payload };
}

export function buildRead(fn) {
  const msg = frameToWire(1, 0, [KIND_READ, fn]);
  assertReadOnly(msg);
  return msg;
}

/**
 * The safety gate: every message goes through this before it is sent.
 * Reads and writes differ by one byte (0x12 / 0x11), so anything that isn't
 * exactly one of READS is refused, including Program Change (which would
 * switch the pedal's patch and could lose an unsaved edit).
 */
export function assertReadOnly(msg) {
  const f = parseFrame(msg);
  const ok = f.ok && f.total === 1 && f.index === 0 && f.payload.length === 2 &&
    f.payload[0] === KIND_READ && Object.values(READS).includes(f.payload[1]);
  if (!ok) throw new Error(`Refused to send (not on the read-only list): ${toHex(msg)}`);
}

/** Collects the frames of one reply; the total says how many to expect. */
export class ReplyAssembler {
  constructor(fn) {
    this.fn = fn;
    this.total = null;
    this.parts = [];
  }

  /** @returns {number[]|null} the whole reply (after the 2-byte echo) once complete */
  push({ total, index, payload }) {
    if (this.total === null) this.total = total;
    if (total !== this.total) throw new Error(`a frame says ${total} in all, earlier ones ${this.total}`);
    this.parts[index] = payload;
    if (this.missing().length) return null;
    const all = this.parts.flat();
    if (all[0] !== KIND_READ || all[1] !== this.fn) {
      throw new Error(`the reply starts ${toHex(all.slice(0, 2))}, expected 12 ${toHex([this.fn])}`);
    }
    return all.slice(2);
  }

  missing() {
    return Array.from({ length: this.total ?? 0 }, (_, i) => i).filter((i) => !this.parts[i]);
  }
}

const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

function text(bytes) {
  const end = bytes.indexOf(0);
  return String.fromCharCode(...(end < 0 ? bytes : bytes.slice(0, end)));
}

/** 100 x [u32 slot, 16-byte name] */
export function decodeNames(data) {
  const rec = 4 + NAME_LEN;
  if (data.length !== NAME_COUNT * rec) throw new Error(`Names reply is ${data.length} bytes, expected ${NAME_COUNT * rec}`);
  const names = [];
  for (let i = 0; i < data.length; i += rec) {
    const slot = u32(data, i);
    if (slot !== i / rec) throw new Error(`Name ${i / rec} says it is slot ${slot}`);
    names.push(text(data.slice(i + 4, i + rec)));
  }
  return names;
}

/** u16 slot, counted from 0 (the GP-5 pads it to 4 bytes). */
export function decodeSlot(data) {
  if (data.length < 2) throw new Error(`Slot reply is ${data.length} bytes, expected at least 2`);
  const slot = data[0] | (data[1] << 8);
  if (slot >= NAME_COUNT) throw new Error(`Slot reply says ${slot}, expected 0-${NAME_COUNT - 1}`);
  return slot;
}

/** [u8 a, u8 b, u16 length, value] records; record (1,1) is said to hold the firmware version. */
export function decodeSettings(data) {
  const records = [];
  let i = 0;
  while (i < data.length) {
    const len = data[i + 2] | (data[i + 3] << 8);
    if (i + 4 > data.length || i + 4 + len > data.length) throw new Error(`Settings record at ${i} runs past the end`);
    records.push({ a: data[i], b: data[i + 1], value: data.slice(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  const fw = records.find((r) => r.a === 1 && r.b === 1 && r.value.length === 4);
  return { records, firmware: fw ? [fw.value[2], fw.value[1], fw.value[0]].join(".") : null };
}

/** A .prst as Valeton Suite is said to export it: header, CRC, name, then the body as read. */
export function buildPrst(name, body) {
  if (body.length !== BODY_LEN) throw new Error(`Patch is ${body.length} bytes, expected ${BODY_LEN}`);
  const nameBytes = Array.from({ length: NAME_LEN }, (_, i) => (i < name.length ? name.charCodeAt(i) & 0xff : 0));
  const tail = [0xff, 0xff, 0xff, 0xff, ...nameBytes, ...body];
  return Uint8Array.from([...PRST_HEAD, crc8(tail), ...tail]);
}
