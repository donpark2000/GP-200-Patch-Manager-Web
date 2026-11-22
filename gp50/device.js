// Read-only GP-50 reader over a Web MIDI input/output pair (or the fake
// pedal). One request at a time, with a quiet gap after each: other projects
// report that the pedal locks up if requests outrun it.

import {
  assertReadOnly, BODY_LEN, buildRead, decodeNames, decodeSettings, decodeSlot, KIND_READ, parseFrame, READS,
  ReplyAssembler, toHex,
} from "./protocol.js";

export const READ_TIMEOUT_MS = 2500;
export const SETTLE_MS = 200;

/** "GP-50", "GP-50 MIDI 1"; never GP-5, GP-500 or GP-200. */
export const isGp50Name = (name) => /GP-50(?!\d)/i.test(name ?? "");

export class Gp50Reader {
  constructor(input, output, log, { timeoutMs = READ_TIMEOUT_MS, settleMs = SETTLE_MS } = {}) {
    Object.assign(this, { input, output, log, timeoutMs, settleMs });
    this.pending = null; // the read in progress: {fn, frame(parsedFrame)}
    this.queue = Promise.resolve();
    input.onmidimessage = (e) => this._onMessage(Array.from(e.data));
  }

  close() {
    this.input.onmidimessage = null;
  }

  async readSettings() { return decodeSettings(await this._read("settings")); }
  async readNames() { return decodeNames(await this._read("names")); }
  async readSlot() { return decodeSlot(await this._read("slot")); }

  async readPatchBody() {
    const body = await this._read("patch");
    if (body.length !== BODY_LEN) throw new Error(`Patch is ${body.length} bytes, expected ${BODY_LEN}`);
    return body;
  }

  _read(what) {
    const run = this.queue.then(() => this._exchange(what));
    this.queue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, this.settleMs)));
    return run;
  }

  _exchange(what) {
    const fn = READS[what];
    const msg = buildRead(fn);
    const t0 = performance.now();
    return new Promise((resolve, reject) => {
      const asm = new ReplyAssembler(fn);
      const done = (settle, value) => {
        clearTimeout(timer);
        this.pending = null;
        settle(value);
      };
      const timer = setTimeout(() => {
        const got = asm.total === null
          ? "no reply at all"
          : `got ${asm.total - asm.missing().length} of ${asm.total} frames, missing ${asm.missing().join(", ")}`;
        done(reject, new Error(`Reading ${what}: ${got} within ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.pending = {
        fn,
        frame: (f) => {
          try {
            const data = asm.push(f);
            if (!data) return;
            this.log.info(`Read ${what}: ${data.length} bytes in ${asm.total} frames, ${Math.round(performance.now() - t0)} ms`);
            done(resolve, data);
          } catch (err) {
            done(reject, new Error(`Reading ${what}: ${err.message}`));
          }
        },
      };
      try {
        this.log.debug(`TX ${toHex(msg)}`);
        assertReadOnly(msg);
        this.output.send(msg);
      } catch (err) {
        done(reject, err);
      }
    });
  }

  _onMessage(msg) {
    this.log.debug(`RX ${toHex(msg)}`);
    const f = parseFrame(msg);
    if (!f.ok) {
      this.log.warn(`Unrecognised message (${f.problem}): ${toHex(msg.slice(0, 24))}${msg.length > 24 ? " ..." : ""}`);
      return;
    }
    if (!this.pending) {
      this.log.info(`The pedal sent this unasked: ${toHex(f.payload)}`);
      return;
    }
    // Something else can arrive mid-read (a knob turned on the pedal): log it
    // and keep waiting.
    if (f.index === 0 && (f.payload[0] !== KIND_READ || f.payload[1] !== this.pending.fn)) {
      this.log.info(`The pedal sent this during a read: ${toHex(f.payload)}`);
      return;
    }
    this.pending.frame(f);
  }
}
