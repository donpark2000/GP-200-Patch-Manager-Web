// A fake GP-200 for tests: answers the identity query and full-dump read
// requests, and accepts flash uploads, the way PROTOCOL.md describes, from
// an in-memory dump per slot. Replies arrive asynchronously, like real Web
// MIDI.
//
// Modelled device behaviour on writes (PROTOCOL.md sections 1-2):
//   - uploads are silently discarded until "enter editor mode" is received
//   - the slot mirrors (file 0x2E, 0x34, 0x90) are set to the target slot
//   - the dead bytes (file 0x43, 0x9F) are always stored as 0x00
//
// `faults(slot, readNumber, chunks)` can return modified read-reply chunks
// (drop, reorder, duplicate, corrupt); `writeFaults(slot, writeNumber,
// chunks)` does the same for incoming upload chunks. Counters start at 1.

import { HEADER, nibbleDecode, nibbleEncode } from "../../src/core/sysex.js";

const CHUNK_RAW = 183; // same stride the write path uses (gp200.py build_upload_chunks)
const DUMP_SHIFT = 0x28;

export class FakePedal {
  constructor({ dumps = new Map(), defaultDump, faults = null, writeFaults = null, answerIdentity = true } = {}) {
    this.dumps = dumps;
    this.defaultDump = defaultDump;
    this.faults = faults;
    this.writeFaults = writeFaults;
    this.answerIdentity = answerIdentity;
    this.editorMode = false;
    this.activeSlot = null;
    this.reads = new Map();
    this.writes = new Map();
    this.sent = [];
    this._upload = [];
    this.input = { onmidimessage: null };
    this.output = { send: (data) => this._receive(Uint8Array.from(data)) };
  }

  dumpOf(slot) {
    return this.dumps.get(slot) ?? this.defaultDump;
  }

  _emit(msg) {
    setTimeout(() => this.input.onmidimessage?.({ data: msg }), 0);
  }

  _receive(msg) {
    this.sent.push(msg);
    const [cmd, sub] = [msg[8], msg[9]];
    if (cmd === 0x11 && sub === 0x04 && this.answerIdentity) {
      this._emit(Uint8Array.from([...HEADER, 0x12, 0x08, 0, 0, 0, 0, 0xf7]));
    } else if (cmd === 0x11 && sub === 0x12) {
      this.editorMode = true;
    } else if (cmd === 0x11 && sub === 0x10) {
      const slot = (msg[25] << 4) | msg[26];
      const n = (this.reads.get(slot) ?? 0) + 1;
      this.reads.set(slot, n);
      let chunks = FakePedal.dumpChunks(this.dumpOf(slot));
      if (this.faults) chunks = this.faults(slot, n, chunks) ?? chunks;
      for (const c of chunks) this._emit(c);
    } else if (cmd === 0x12 && sub === 0x20) {
      this._upload.push(msg);
      // A burst ends with its one short chunk (the image isn't a multiple of 183).
      if (msg.length - 14 < CHUNK_RAW * 2) this._commitUpload();
    } else if (cmd === 0x12 && sub === 0x08) {
      this.activeSlot = (msg[25] << 4) | msg[26];
    }
  }

  _commitUpload() {
    let chunks = this._upload;
    this._upload = [];
    const peekSlot = nibbleDecode(chunks[0].subarray(13, 13 + 28))[6];
    const n = (this.writes.get(peekSlot) ?? 0) + 1;
    this.writes.set(peekSlot, n);
    if (this.writeFaults) chunks = this.writeFaults(peekSlot, n, chunks) ?? chunks;
    if (!this.editorMode) return; // real pedal: silently discarded

    const image = new Uint8Array(CHUNK_RAW * chunks.length);
    let end = 0;
    for (const c of chunks) {
      const off = (c[11] & 0x7f) | ((c[12] & 0x7f) << 7);
      const raw = nibbleDecode(c.subarray(13, c.length - 1));
      image.set(raw, off);
      end = Math.max(end, off + raw.length);
    }
    const slot = image[6];
    const dump = Uint8Array.from(this.dumpOf(slot));
    const content = image.subarray(14, end); // file bytes from 0x2E
    dump.set(content.subarray(0, dump.length - (0x2e - DUMP_SHIFT)), 0x2e - DUMP_SHIFT);
    for (const off of [0x2e, 0x34, 0x90]) dump[off - DUMP_SHIFT] = slot;
    for (const off of [0x43, 0x9f]) dump[off - DUMP_SHIFT] = 0;
    this.dumps.set(slot, dump);
  }

  /** Split a dump into cmd=0x12 sub=0x18 reply chunks. */
  static dumpChunks(dump) {
    const chunks = [];
    for (let off = 0; off < dump.length; off += CHUNK_RAW) {
      const nib = nibbleEncode(dump.subarray(off, off + CHUNK_RAW));
      chunks.push(Uint8Array.from([...HEADER, 0x12, 0x18, 0x09, off & 0x7f, (off >> 7) & 0x7f, ...nib, 0xf7]));
    }
    return chunks;
  }
}
