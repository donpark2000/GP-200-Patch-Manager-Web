// Writes one GP-50 patch at a time, frame by frame, each acknowledged before
// the next. Any problem stops it for good (until Connect makes a new one):
// no retries, since what the pedal does with a half-sent patch isn't known.

import { Gp50Reader } from "./device.js";
import { parseFrame, toHex } from "./protocol.js";
import { ACK, buildPatchWrite, WriteGate } from "./write-protocol.js";

/** Other projects wait 150-300 ms; nothing is sent after a missing one here, so waiting longer is safe. */
export const ACK_TIMEOUT_MS = 1000;
export const FRAME_GAP_MS = 20;
/** Before and after a write: time for the pedal to store things, and for a surplus acknowledgement to show up. */
export const WRITE_SETTLE_MS = 500;

const sleep = (ms) => (ms ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export class Gp50Writer extends Gp50Reader {
  constructor(input, output, log, { ackTimeoutMs = ACK_TIMEOUT_MS, frameGapMs = FRAME_GAP_MS, writeSettleMs = WRITE_SETTLE_MS, ...rest } = {}) {
    super(input, output, log, rest);
    Object.assign(this, { ackTimeoutMs, frameGapMs, writeSettleMs });
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

  /** @returns {Promise<{frames: number, ms: number, slowestAckMs: number}>} */
  async writeSlotPatch(slot, prst, { confirmed = false } = {}) {
    if (confirmed !== true) throw new Error("Refused: the write wasn't confirmed");
    const frames = buildPatchWrite(slot, prst);
    const gate = new WriteGate(slot, prst);
    return this._queued(async () => {
      if (this.halted) throw new Error(`Refused: writing stopped earlier (${this.halted}). Press Connect again first`);
      try {
        return await this._write(slot, frames, gate);
      } catch (err) {
        this.halted = err.message;
        throw err;
      } finally {
        this.writing = false;
      }
    });
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
        throw new Error(`Writing slot ${slot}, frame ${i + 1} of ${frames.length}: ${err.message}`);
      }
      times.push(Math.round(performance.now() - sentAt));
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
      const timer = setTimeout(() => done(reject, new Error(`not acknowledged within ${this.ackTimeoutMs} ms`)), this.ackTimeoutMs);
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
      this.onAck?.reject(new Error(`the pedal answered ${toHex(f.payload)}, expected ${toHex(ACK)}`));
      return;
    }
    this.acks++;
    if (this.onAck) this.onAck.resolve();
    else this.log.warn("An acknowledgement nothing was waiting for");
  }
}
