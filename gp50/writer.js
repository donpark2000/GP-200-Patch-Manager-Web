// Writes one GP-50 patch at a time, frame by frame, each acknowledged before
// the next. A missing acknowledgement, or the pedal's "not stored", starts
// that patch again, up to WRITE_ATTEMPTS in all: the pedal drops a half-sent
// patch and accepts it again (journal 2026-11-22). Anything else stops it for
// good (until Connect makes a new one).

import { Gp50Reader } from "./device.js";
import { buildRead, parseFrame, READS, toHex } from "./protocol.js";
import { ACK, buildPatchWrite, REFUSAL, TEST_RANGE, WriteGate } from "./write-protocol.js";

/**
 * In about 37,000 frames every acknowledgement came within 122 ms (a patch's
 * last) or was held until the pedal's next message, never later by itself
 * (25 held, up to 5 s waited; journal 2026-11-23 "GP-50 speed").
 */
export const ACK_TIMEOUT_MS = 1000;
export const ACK_SLOW_MS = 200;
export const WRITE_ATTEMPTS = 3;
/** Each frame goes when the last is acknowledged: 400 writes at 0 matched (was 20). */
export const FRAME_GAP_MS = 0;
/**
 * Before and after a write: for a surplus acknowledgement to show up. The
 * pedal's "patch list changed" comes with the last acknowledgement, so there
 * is nothing else to wait for (was 500).
 */
export const WRITE_SETTLE_MS = 100;

const sleep = (ms) => (ms ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

const startAgain = (text) => Object.assign(new Error(text), { startAgain: true });

export class Gp50Writer extends Gp50Reader {
  constructor(input, output, log, { ackTimeoutMs = ACK_TIMEOUT_MS, range = TEST_RANGE, frameGapMs = FRAME_GAP_MS, writeSettleMs = WRITE_SETTLE_MS, ...rest } = {}) {
    super(input, output, log, rest);
    Object.assign(this, { ackTimeoutMs, range, frameGapMs, writeSettleMs });
    this.halted = null; // why writing stopped, once it has
    this.closed = false;
    this.writing = false;
    this.acks = 0; // since the write began
    this.onAck = null; // the frame waiting for its acknowledgement: {resolve, reject}
  }

  close() {
    this.closed = true;
    this.onAck?.reject(new Error("the connection was closed"));
    super.close();
  }

  /** @returns {Promise<{frames: number, ms: number, slowestAckMs: number, attempts: number}>} */
  async writeSlotPatch(slot, prst, { confirmed = false } = {}) {
    if (confirmed !== true) throw new Error("Refused: the write wasn't confirmed");
    const frames = buildPatchWrite(slot, prst, this.range);
    return this._queued(async () => {
      if (this.halted) throw new Error(`Refused: writing stopped earlier (${this.halted}). Press Connect again first`);
      try {
        for (let attempt = 1; ; attempt++) {
          try {
            return { ...(await this._write(slot, frames, new WriteGate(slot, prst, this.range))), attempts: attempt };
          } catch (err) {
            if (!err.startAgain || this.closed) throw err;
            if (attempt === WRITE_ATTEMPTS) throw new Error(`${err.message} (attempt ${attempt} of ${WRITE_ATTEMPTS})`);
            this.log.warn(`${err.message}; attempt ${attempt} of ${WRITE_ATTEMPTS}. Starting this patch again`);
            await this._clear();
          }
        }
      } catch (err) {
        this.halted = err.message;
        throw err;
      } finally {
        this.writing = false;
      }
    });
  }

  // A held-up acknowledgement came out with the pedal's next message (Q9), so
  // ask for something harmless, then wait until nothing more comes. Only
  // before starting again: a read during a write makes the pedal drop it.
  async _clear() {
    const before = this.acks;
    await this._exchange("slot", READS.slot, buildRead(READS.slot));
    await this._untilQuiet();
    this.log.warn(`Before starting again: ${this.acks - before} late acknowledgement(s)`);
  }

  async _write(slot, frames, gate) {
    await sleep(this.writeSettleMs);
    this.log.info(`Writing slot ${slot}: ${frames.length} frames`);
    const t0 = performance.now();
    const times = [];
    this.acks = 0;
    this.writing = true;
    for (const [i, msg] of frames.entries()) {
      if (i) await sleep(this.frameGapMs);
      if (this.acks !== i) throw new Error(`Writing slot ${slot}: ${this.acks} acknowledgements for ${i} frames`);
      const sentAt = performance.now();
      try {
        await this._sendFrame(gate, msg);
      } catch (err) {
        throw Object.assign(new Error(`Writing slot ${slot}, frame ${i + 1} of ${frames.length}: ${err.message}`), { startAgain: err.startAgain });
      }
      const took = Math.round(performance.now() - sentAt);
      if (took > ACK_SLOW_MS) this.log.warn(`Slow acknowledgement: slot ${slot}, frame ${i + 1} of ${frames.length}, ${took} ms`);
      times.push(took);
    }
    const ms = Math.round(performance.now() - t0);
    await sleep(this.writeSettleMs);
    if (this.acks !== frames.length) throw new Error(`Writing slot ${slot}: ${this.acks} acknowledgements for ${frames.length} frames`);
    this.log.info(`Wrote slot ${slot}: ${frames.length} frames, all acknowledged, ${ms} ms (acknowledgements after ${times.join(", ")} ms)`);
    return { frames: frames.length, ms, slowestAckMs: Math.max(...times) };
  }

  _sendFrame(gate, msg) {
    return new Promise((resolve, reject) => {
      const done = (settle, value) => {
        clearTimeout(timer);
        this.onAck = null;
        settle(value);
      };
      const timer = setTimeout(() => done(reject, startAgain(`not acknowledged within ${this.ackTimeoutMs} ms`)), this.ackTimeoutMs);
      this.onAck = { resolve: () => done(resolve), reject: (err) => done(reject, err) };
      try {
        if (this.closed) throw new Error("the connection was closed");
        this.log.debug(`TX ${toHex(msg)}`);
        gate.check(msg);
        this.output.send(msg);
      } catch (err) {
        done(reject, err);
      }
    });
  }

  _onMessage(msg) {
    const f = this.writing ? parseFrame(msg) : null;
    if (!f?.ok || f.payload[0] !== ACK[0]) {
      super._onMessage(msg);
      return;
    }
    this.lastRx = performance.now();
    this.log.debug(`RX ${toHex(msg)}`);
    if (toHex(f.payload) !== toHex(ACK)) {
      this.log.warn(`Unexpected answer: ${toHex(f.payload)}`);
      const text = `the pedal answered ${toHex(f.payload)}, expected ${toHex(ACK)}`;
      this.onAck?.reject(toHex(f.payload) === toHex(REFUSAL) ? startAgain(`${text}: it didn't store the patch`) : new Error(text));
      return;
    }
    this.acks++;
    if (this.onAck) this.onAck.resolve();
    else this.log.warn("An acknowledgement nothing was waiting for");
  }
}
