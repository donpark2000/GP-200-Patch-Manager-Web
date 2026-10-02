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
//
// `commitMs` delays when an upload lands; reads during it get the old patch,
// or no reply at all with `readsDuringCommit: "ignore"`.
//
// `fragile: {off, windowMs}` models the fault the 2026-10-01 full restore
// found: if an upload or a preset change to another slot arrives within
// `windowMs` of a preset change, the pedal zeroes file offset `off` in the
// slot it had just switched to -- after any verify of that slot. With
// `readEndsWindow: true`, a read request after the preset change ends the
// window (the working hypothesis for why the timing test, whose verify read
// comes right after the switch, didn't reproduce the fault on hardware).
//
// `storeAs: {off, value}`: every upload is stored with `value` at file
// offset `off`, whatever was sent (how the pedal treats the pedal-managed
// bytes in prst.js; on any other offset, a write that doesn't land intact).
//
// `unloadedReads: {off, value}` models what "Love Yourself" did on
// 2026-10-01 (runs B and C): after an upload, reads of that slot show
// `value` at file offset `off` until a preset change selects the slot;
// from then on they show what was written.

import { HEADER, nibbleDecode, nibbleEncode } from "../../src/core/sysex.js";

const CHUNK_RAW = 183; // same stride the write path uses (gp200.py build_upload_chunks)
// Read replies as the real pedal sends them (hardware logs, journal
// 2026-10-02 "Hosted site, this computer"): 185-byte chunks at offsets
// 0, 185, ... 1110; a 1176-byte dump ends in a 66-byte chunk.
const READ_CHUNK_RAW = 185;
const DUMP_SHIFT = 0x28;

export class FakePedal {
  constructor({
    dumps = new Map(), defaultDump, faults = null, writeFaults = null, answerIdentity = true,
    commitMs = 0, readsDuringCommit = "old", fragile = null, unloadedReads = null, storeAs = null,
  } = {}) {
    this.storeAs = storeAs;
    this.unloadedReads = unloadedReads;
    this._unloaded = new Set(); // slots uploaded to and not selected since
    this.dumps = dumps;
    this.defaultDump = defaultDump;
    this.faults = faults;
    this.writeFaults = writeFaults;
    this.answerIdentity = answerIdentity;
    this.commitMs = commitMs;
    this.readsDuringCommit = readsDuringCommit;
    this._pending = null; // an upload still committing (commitMs)
    this.readsIgnored = 0;
    this.fragile = fragile;
    this.selectedAt = null;
    this.fragileHits = 0;
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
      if (this.fragile?.readEndsWindow) this.selectedAt = null;
      this._finishCommitIfDue();
      if (this._pending && this.readsDuringCommit === "ignore") {
        this.readsIgnored++;
        return;
      }
      const n = (this.reads.get(slot) ?? 0) + 1;
      this.reads.set(slot, n);
      let dump = this.dumpOf(slot);
      if (this.unloadedReads && this._unloaded.has(slot)) {
        dump = Uint8Array.from(dump);
        dump[this.unloadedReads.off - DUMP_SHIFT] = this.unloadedReads.value;
      }
      let chunks = FakePedal.dumpChunks(dump);
      if (this.faults) chunks = this.faults(slot, n, chunks) ?? chunks;
      for (const c of chunks) this._emit(c);
    } else if (cmd === 0x12 && sub === 0x20) {
      if (this._upload.length === 0) this._maybeDisturb();
      this._upload.push(msg);
      // A burst ends with its one short chunk (the image isn't a multiple of 183).
      if (msg.length - 14 < CHUNK_RAW * 2) this._commitUpload();
    } else if (cmd === 0x12 && sub === 0x08) {
      const slot = (msg[25] << 4) | msg[26];
      if (slot !== this.activeSlot) this._maybeDisturb();
      this.activeSlot = slot;
      this._unloaded.delete(slot);
      this.selectedAt = performance.now();
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
    this._unloaded.add(slot);
    const dump = Uint8Array.from(this.dumpOf(slot));
    const content = image.subarray(14, end); // file bytes from 0x2E
    dump.set(content.subarray(0, dump.length - (0x2e - DUMP_SHIFT)), 0x2e - DUMP_SHIFT);
    for (const off of [0x2e, 0x34, 0x90]) dump[off - DUMP_SHIFT] = slot;
    for (const off of [0x43, 0x9f]) dump[off - DUMP_SHIFT] = 0;
    if (this.storeAs) dump[this.storeAs.off - DUMP_SHIFT] = this.storeAs.value;
    if (!this.commitMs) {
      this.dumps.set(slot, dump);
      return;
    }
    this._pending = { slot, dump, due: performance.now() + this.commitMs };
    setTimeout(() => this._finishCommitIfDue(), this.commitMs);
  }

  /** The `fragile` fault: a command too soon after a preset change. */
  _maybeDisturb() {
    const f = this.fragile;
    if (!f || this.activeSlot === null || this.selectedAt === null) return;
    if (performance.now() - this.selectedAt >= f.windowMs) return;
    const dump = Uint8Array.from(this.dumpOf(this.activeSlot));
    if (dump[f.off - DUMP_SHIFT] === 0) return;
    dump[f.off - DUMP_SHIFT] = 0;
    this.dumps.set(this.activeSlot, dump);
    this.fragileHits++;
  }

  // Timers can fire late, so a read checks the clock too.
  _finishCommitIfDue() {
    if (this._pending && performance.now() >= this._pending.due) {
      this.dumps.set(this._pending.slot, this._pending.dump);
      this._pending = null;
    }
  }

  /** Split a dump into cmd=0x12 sub=0x18 reply chunks. */
  static dumpChunks(dump) {
    const chunks = [];
    for (let off = 0; off < dump.length; off += READ_CHUNK_RAW) {
      const nib = nibbleEncode(dump.subarray(off, off + READ_CHUNK_RAW));
      chunks.push(Uint8Array.from([...HEADER, 0x12, 0x18, 0x09, off & 0x7f, (off >> 7) & 0x7f, ...nib, 0xf7]));
    }
    return chunks;
  }
}
