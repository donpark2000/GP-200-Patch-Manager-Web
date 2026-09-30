// GP-200 SysEx message building and parsing (read path only).
// Spec: PROTOCOL.md section 2 in the CLI repo. Ported from gp200.py.

export const HEADER = [0xf0, 0x21, 0x25, 0x7e, 0x47, 0x50, 0x2d, 0x32];

export const CMD_REQUEST = 0x11;
export const CMD_RESPONSE = 0x12;
export const SUB_DUMP_CHUNK = 0x18; // response to a read request
export const SUB_IDENTITY_REPLY = 0x08; // response to the identity query
export const DUMP_CHUNK_COUNT = 7; // a full-dump read always arrives as 7 chunks
export const CHUNK_PAYLOAD_START = 13; // header(8) + cmd + sub + outer byte + 2 offset bytes

export function nibbleEncode(data) {
  const out = new Uint8Array(data.length * 2);
  for (let i = 0; i < data.length; i++) {
    out[2 * i] = (data[i] >> 4) & 0x0f;
    out[2 * i + 1] = data[i] & 0x0f;
  }
  return out;
}

/** Like the CLI: masks each nibble to 4 bits and ignores an odd trailing byte. */
export function nibbleDecode(data) {
  const out = new Uint8Array(Math.floor(data.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = ((data[2 * i] & 0x0f) << 4) | (data[2 * i + 1] & 0x0f);
  }
  return out;
}

/** Full-dump (or name-only) read request for one slot. */
export function buildReadRequest(slot, nameOnly = false) {
  const sh = (slot >> 4) & 0x0f;
  const sl = slot & 0x0f;
  return Uint8Array.from([
    ...HEADER,
    CMD_REQUEST, nameOnly ? 0x20 : 0x10,
    0, 0, 0, 0, 0, 0, 0, 0,
    0x04, 0, 0, 0,
    0x01, 0,
    0,
    sh, sl,
    0, 0, 0,
    0x01, 0,
    0, 0,
    0x04, 0, 0,
    sh, sl,
    0, 0,
    sh, sl,
    0, 0,
    0xf7,
  ]);
}

/** Sent once at connect; the reply's arrival matters, not its contents. */
export function buildIdentityQuery() {
  return Uint8Array.from([...HEADER, CMD_REQUEST, 0x04, 0, 0, 0, 0, 0x01, 0x02, 0, 0, 0, 0, 0, 0xf7]);
}

/** Sent once at connect, after the identity query. No reply expected. */
export function buildEnterEditorMode() {
  return Uint8Array.from([...HEADER, CMD_REQUEST, 0x12, 0, 0, 0, 0xf7]);
}

export function isSysex(msg, cmd, sub) {
  if (msg.length <= 10) return false;
  for (let i = 0; i < HEADER.length; i++) if (msg[i] !== HEADER[i]) return false;
  return msg[8] === cmd && msg[9] === sub;
}

/** A dump chunk's position, 7 bits per byte (PROTOCOL.md "Encodings"). */
export function chunkOffset(msg) {
  return (msg[11] & 0x7f) | ((msg[12] & 0x7f) << 7);
}

export function chunkPayload(msg) {
  return msg.subarray(CHUNK_PAYLOAD_START, msg.length - 1);
}

/** Order chunks by offset, join their nibble payloads, decode. */
export function assembleChunks(chunks) {
  const ordered = [...chunks].sort((a, b) => chunkOffset(a) - chunkOffset(b));
  const parts = ordered.map(chunkPayload);
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    joined.set(p, pos);
    pos += p.length;
  }
  return nibbleDecode(joined);
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

/** One-line description of a message for the debug log. Dump chunks are
 *  shown in full, as in the CLI: they're the messages under scrutiny. */
export function describeMessage(msg) {
  const n = msg.length;
  if (n > 10 && HEADER.every((b, i) => msg[i] === b)) {
    const cmd = msg[8];
    const sub = msg[9];
    const body = msg.subarray(10, n - 1);
    const tag = `GP-200 sysex cmd=0x${hex2(cmd)} sub=0x${hex2(sub)} ${n} bytes`;
    if (cmd === CMD_RESPONSE && sub === SUB_DUMP_CHUNK) return `${tag} body: ${toHex(body)}`;
    const more = body.length > 24 ? ` ...(+${body.length - 24} more)` : "";
    return `${tag} body: ${toHex(body.subarray(0, 24))}${more}`;
  }
  const more = n > 32 ? ` ...(+${n - 32} more)` : "";
  return `non-GP-200 or malformed, ${n} bytes: ${toHex(msg.subarray(0, 32))}${more}`;
}

function hex2(b) {
  return b.toString(16).toUpperCase().padStart(2, "0");
}
