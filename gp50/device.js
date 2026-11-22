// Read-only GP-50 reader over a Web MIDI input/output pair (or the fake
// pedal). One request at a time, with a quiet gap after each: other projects
// report that the pedal locks up if requests outrun it.

import {
  assertReadOnly, BODY_LEN, buildRead, buildSlotRead, decodeNames, decodeSettings, decodeSlot, decodeSlotPatch, KIND_READ,
  parseFrame, READ_SLOT_PATCH, READS, ReplyAssembler, toHex,
} from "./protocol.js";

export const READ_TIMEOUT_MS = 2500;
export const SETTLE_MS = 200;
/** After a failed read, wait until the pedal has sent nothing for this long. */
export const QUIET_MS = 1000;

/** "GP-50", "GP-50 MIDI 1"; never GP-5, GP-500 or GP-200. */
export const isGp50Name = (name) => /GP-50(?!\d)/i.test(name ?? "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Gp50Reader {
  constructor(input, output, log, { timeoutMs = READ_TIMEOUT_MS, settleMs = SETTLE_MS, quietMs = QUIET_MS } = {}) {
    Object.assign(this, { input, output, log, timeoutMs, settleMs, quietMs });
    this.lastRx = 0;
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

  /** Any slot, without selecting it. */
  async readSlotPatch(slot) {
    const msg = buildSlotRead(slot);
    return decodeSlotPatch(await this._queued(() => this._exchange(`slot ${slot}'s patch`, READ_SLOT_PATCH, msg)));
  }

  _read(what) {
    return this._queued(() => this._exchange(what, READS[what], buildRead(READS[what])));
  }

  _queued(exchange) {
    const run = this.queue.then(exchange);
    this.queue = run.then(() => sleep(this.settleMs), () => this._untilQuiet());
    return run;
  }

  // A slot's reply doesn't say which slot it is. If the rest of a failed
  // reply came in late it could pass for the next slot's, so let it finish.
  async _untilQuiet() {
    const since = performance.now();
    for (;;) {
      const wait = Math.max(this.lastRx, since) + this.quietMs - performance.now();
      if (wait <= 0) return;
      await sleep(wait);
    }
  }

  _exchange(what, fn, msg) {
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
    this.lastRx = performance.now();
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
