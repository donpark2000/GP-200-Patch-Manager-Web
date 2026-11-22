// A fake GP-50 for the tests and for gp50/?fake. Answers the reads the
// way protocol.js describes; anything else is recorded in `refused` and not
// answered. `faults(wireFrames, fn, args)` can drop, change or reorder a reply.
// With `writable` it also takes patch writes, as Suite's captured one:
// `ackFaults(acks, index, slot)` can change the answer to a frame, and
// `storeFault(slot, prstFrom0x19)` what is stored. As VLTN reports, an
// unacknowledged frame makes it drop the whole write.

import { BODY_LEN, frameToWire, KIND_READ, NAME_COUNT, parseFrame, READ_SLOT_PATCH, READS } from "./protocol.js";

export class FakeGp50 {
  constructor({ slot = 2, firmware = [1, 1, 0], faults = (frames) => frames, writable = false, ackFaults = (acks) => acks, storeFault = (_, data) => data, later = (fn) => setTimeout(fn, 1) } = {}) {
    this.slot = slot;
    this.firmware = firmware;
    Object.assign(this, { faults, writable, ackFaults, storeFault, later });
    this.stored = []; // slots written, in order
    this.incoming = []; // the write in progress: payload so far
    this.nextFrame = 0;
    this.sent = []; // every message the app sent
    this.refused = [];
    this.names = Array.from({ length: NAME_COUNT }, (_, i) => `Fake ${String(i).padStart(2, "0")}`);
    this.bodies = Array.from({ length: NAME_COUNT }, (_, s) => Array.from({ length: BODY_LEN }, (_, i) => (i * 7 + s) & 0xff));
    this.input = { name: "GP-50", id: "fake-in", onmidimessage: null };
    this.output = { name: "GP-50", id: "fake-out", send: (msg) => this._receive(Array.from(msg)) };
  }

  /** The selected patch. */
  get body() { return this.bodies[this.slot]; }
  set body(body) { this.bodies[this.slot] = body; }

  /** Something the pedal sends by itself, e.g. after a knob is turned. */
  emit(payload) {
    this._deliver([frameToWire(1, 0, payload)]);
  }

  _receive(msg) {
    this.sent.push(msg);
    const f = parseFrame(msg);
    if (this.writable && f.ok && f.total === 29) {
      this._receiveWrite(f);
      return;
    }
    const data = f.ok && f.payload[0] === KIND_READ ? this._answer(f.payload[1], f.payload.slice(2)) : null;
    if (!data) {
      this.refused.push(msg);
      return;
    }
    const payload = [KIND_READ, f.payload[1], ...data];
    const total = Math.ceil(payload.length / 19);
    const frames = Array.from({ length: total }, (_, i) => frameToWire(total, i, payload.slice(i * 19, i * 19 + 19)));
    this.later(() => this._deliver(this.faults(frames, f.payload[1], f.payload.slice(2))));
  }

  _receiveWrite(f) {
    if (f.index === 0) {
      this.incoming = [];
      this.nextFrame = 0;
    }
    if (f.index !== this.nextFrame) return; // dropped: not acknowledged
    this.incoming.push(...f.payload);
    this.nextFrame++;
    const slot = this.incoming[2];
    const acks = this.ackFaults([frameToWire(1, 0, [0x14, 0x08, 0x00])], f.index, slot);
    if (!acks.length) this.nextFrame = -1;
    else if (f.index === f.total - 1) this._store(slot, this.storeFault(slot, this.incoming.slice(6)));
    this.later(() => this._deliver(acks));
  }

  _store(slot, data) {
    this.names[slot] = String.fromCharCode(...data.slice(0, 16)).split(String.fromCharCode(0))[0];
    this.bodies[slot] = data.slice(16);
    this.stored.push(slot);
  }

  _answer(fn, args) {
    if (fn === READ_SLOT_PATCH && args.length === 4) return [0xff, 0xff, 0xff, 0xff, ...this._nameBytes(args[0]), ...this.bodies[args[0]]];
    if (args.length) return null;
    if (fn === READS.slot) return [this.slot, 0];
    if (fn === READS.patch) return this.body;
    if (fn === READS.settings) {
      const [major, minor, patch] = this.firmware;
      return [1, 1, 4, 0, patch, minor, major, 1, 2, 2, 4, 0, 50, 0, 0, 0];
    }
    if (fn === READS.names) {
      return this.names.flatMap((_, i) => [i, 0, 0, 0, ...this._nameBytes(i)]);
    }
    return null;
  }

  _nameBytes(slot) {
    const n = this.names[slot];
    return Array.from({ length: 16 }, (_, k) => (k < n.length ? n.charCodeAt(k) : 0));
  }

  _deliver(frames) {
    for (const data of frames) this.input.onmidimessage?.({ data });
  }
}
