// A fake GP-200 for tests: answers the identity query and full-dump read
// requests the way PROTOCOL.md describes, from an in-memory dump per slot.
// Replies arrive asynchronously, like real Web MIDI.
//
// `faults(slot, readNumber, chunks)` can return modified chunks to simulate
// glitches: drop some (timeout), reorder, duplicate, corrupt. readNumber
// counts reads of that slot, starting at 1.

import { HEADER, nibbleEncode } from "../../src/core/sysex.js";

const CHUNK_RAW = 183; // same stride the write path uses (gp200.py build_upload_chunks)

export class FakePedal {
  constructor({ dumps = new Map(), defaultDump, faults = null, answerIdentity = true } = {}) {
    this.dumps = dumps;
    this.defaultDump = defaultDump;
    this.faults = faults;
    this.answerIdentity = answerIdentity;
    this.reads = new Map();
    this.sent = [];
    this.input = { onmidimessage: null };
    this.output = { send: (data) => this._receive(Uint8Array.from(data)) };
  }

  _emit(msg) {
    setTimeout(() => this.input.onmidimessage?.({ data: msg }), 0);
  }

  _receive(msg) {
    this.sent.push(msg);
    if (msg[8] === 0x11 && msg[9] === 0x04 && this.answerIdentity) {
      this._emit(Uint8Array.from([...HEADER, 0x12, 0x08, 0, 0, 0, 0, 0xf7]));
    } else if (msg[8] === 0x11 && msg[9] === 0x10) {
      const slot = (msg[25] << 4) | msg[26];
      const n = (this.reads.get(slot) ?? 0) + 1;
      this.reads.set(slot, n);
      let chunks = FakePedal.dumpChunks(this.dumps.get(slot) ?? this.defaultDump);
      if (this.faults) chunks = this.faults(slot, n, chunks) ?? chunks;
      for (const c of chunks) this._emit(c);
    }
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
