// A fake GP-50 for the tests and for gp50/?fake. Answers the four reads the
// way protocol.js describes; anything else is recorded in `refused` and not
// answered. `faults(wireFrames, fn)` can drop, change or reorder a reply.

import { BODY_LEN, frameToWire, KIND_READ, NAME_COUNT, parseFrame, READS } from "./protocol.js";

export class FakeGp50 {
  constructor({ slot = 2, firmware = [1, 1, 0], faults = (frames) => frames } = {}) {
    this.slot = slot;
    this.firmware = firmware;
    this.faults = faults;
    this.sent = []; // every message the app sent
    this.refused = [];
    this.names = Array.from({ length: NAME_COUNT }, (_, i) => `Fake ${String(i).padStart(2, "0")}`);
    this.body = Array.from({ length: BODY_LEN }, (_, i) => (i * 7) & 0xff);
    this.input = { name: "GP-50", id: "fake-in", onmidimessage: null };
    this.output = { name: "GP-50", id: "fake-out", send: (msg) => this._receive(Array.from(msg)) };
  }

  /** Something the pedal sends by itself, e.g. after a knob is turned. */
  emit(payload) {
    this._deliver([frameToWire(1, 0, payload)]);
  }

  _receive(msg) {
    this.sent.push(msg);
    const f = parseFrame(msg);
    const data = f.ok && f.payload[0] === KIND_READ ? this._answer(f.payload[1]) : null;
    if (!data) {
      this.refused.push(msg);
      return;
    }
    const payload = [KIND_READ, f.payload[1], ...data];
    const total = Math.ceil(payload.length / 19);
    const frames = Array.from({ length: total }, (_, i) => frameToWire(total, i, payload.slice(i * 19, i * 19 + 19)));
    setTimeout(() => this._deliver(this.faults(frames, f.payload[1])), 1);
  }

  _answer(fn) {
    if (fn === READS.slot) return [this.slot, 0];
    if (fn === READS.patch) return this.body;
    if (fn === READS.settings) {
      const [major, minor, patch] = this.firmware;
      return [1, 1, 4, 0, patch, minor, major, 1, 2, 2, 4, 0, 50, 0, 0, 0];
    }
    if (fn === READS.names) {
      return this.names.flatMap((n, i) => [i, 0, 0, 0, ...Array.from({ length: 16 }, (_, k) => (k < n.length ? n.charCodeAt(k) : 0))]);
    }
    return null;
  }

  _deliver(frames) {
    for (const data of frames) this.input.onmidimessage?.({ data });
  }
}
