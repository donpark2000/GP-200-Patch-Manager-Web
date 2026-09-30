// Minimal ZIP reader for Node (stored and deflated entries), used by the
// compare tool and by tests. Reads the central directory, so it handles
// both this app's zips and the CLI's (Python zipfile, deflated).

import { inflateRawSync } from "node:zlib";
import { crc32 } from "../src/core/zip.js";

/** @returns {Map<string, Uint8Array>} entry name -> contents, in archive order */
export function readZip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory record)");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error(`bad central directory entry ${n}`);
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nameBytes = u8.subarray(p + 46, p + 46 + nameLen);
    const name = flags & 0x0800 ? new TextDecoder().decode(nameBytes) : latin1(nameBytes);
    const dataStart = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = u8.subarray(dataStart, dataStart + csize);
    let data;
    if (method === 0) data = Uint8Array.from(raw);
    else if (method === 8) data = new Uint8Array(inflateRawSync(raw));
    else throw new Error(`${name}: unsupported compression method ${method}`);
    if (crc32(data) !== crc) throw new Error(`${name}: CRC mismatch`);
    out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function latin1(bytes) {
  // Python writes plain-ASCII names without the UTF-8 flag; cp437 and
  // latin-1 agree on ASCII, which is all an unflagged name can hold here.
  return String.fromCharCode(...bytes);
}
