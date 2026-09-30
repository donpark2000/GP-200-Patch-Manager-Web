// Talking to the pedal over a Web MIDI input/output pair.
//
// Transport-agnostic: `input` needs an `onmidimessage` property and `output`
// a `send(Uint8Array)` method -- real Web MIDI ports in the browser, or the
// fake pedal in tests/helpers/fake-pedal.js under Node.
//
// Reliability rules (DESIGN.md): one read per slot, cheap sanity checks, and
// a re-read only when a read times out or fails a check. No "read until two
// reads agree" loop; the export normalizes the known-noisy bytes instead.

import {
  assembleChunks,
  buildEnterEditorMode,
  buildIdentityQuery,
  buildReadRequest,
  chunkOffset,
  chunkPayload,
  CMD_RESPONSE,
  describeMessage,
  DUMP_CHUNK_COUNT,
  isSysex,
  SUB_DUMP_CHUNK,
  SUB_IDENTITY_REPLY,
} from "./sysex.js";
import { MIN_DUMP_LEN } from "./prst.js";
import { slotToLabel } from "./slots.js";

export const READ_TIMEOUT_MS = 2000; // same budget as the CLI's READ_TIMEOUT_S
export const READ_ATTEMPTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ReadError extends Error {
  constructor(slot, reason) {
    super(`couldn't read ${slotToLabel(slot)}: ${reason}`);
    this.name = "ReadError";
    this.slot = slot;
    this.reason = reason;
  }
}

/** Sanity checks on one complete read. Returns a list of problems (empty = OK). */
export function checkDump(chunks, decoded) {
  const problems = [];
  for (const msg of chunks) {
    const payload = chunkPayload(msg);
    const at = `chunk at offset ${chunkOffset(msg)}`;
    if (payload.length % 2 !== 0) problems.push(`${at} has an odd payload length (${payload.length})`);
    const bad = payload.findIndex((b) => b > 0x0f);
    if (bad !== -1) problems.push(`${at} has a non-nibble byte 0x${payload[bad].toString(16)} at +${bad}`);
  }
  if (decoded.length < MIN_DUMP_LEN) {
    problems.push(`dump is only ${decoded.length} bytes (need at least ${MIN_DUMP_LEN})`);
  }
  return problems;
}

export class GP200 {
  /**
   * @param {object} opts
   * @param {{onmidimessage: any}} opts.input
   * @param {{send: (data: Uint8Array) => void}} opts.output
   * @param {import("./log.js").Logger} opts.log
   * @param {number} [opts.timeoutMs]
   * @param {number} [opts.attempts]
   */
  constructor({ input, output, log, timeoutMs = READ_TIMEOUT_MS, attempts = READ_ATTEMPTS }) {
    this.input = input;
    this.output = output;
    this.log = log;
    this.timeoutMs = timeoutMs;
    this.attempts = attempts;
    this._waiter = null;
    this.input.onmidimessage = (e) => this._onMessage(e.data);
  }

  close() {
    this.input.onmidimessage = null;
    if (this._waiter) this._finish(this._waiter);
  }

  /** Identity query + enter editor mode, as the CLI does on every connect. */
  async connect() {
    const reply = await this._request(buildIdentityQuery(), SUB_IDENTITY_REPLY, 1);
    if (reply.length) {
      this.log.info("Pedal answered the identity query");
    } else {
      this.log.warn("No identity reply within the timeout; continuing anyway (reads don't need it)");
    }
    this._send(buildEnterEditorMode());
    await sleep(100);
  }

  /**
   * Read one slot's full dump.
   * @returns {Promise<{decoded: Uint8Array, chunks: Uint8Array[], attempt: number, ms: number}>}
   * @throws {ReadError} after `attempts` failed tries
   */
  async readDump(slot) {
    const label = slotToLabel(slot);
    let reason = "";
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      const started = performance.now();
      const chunks = await this._request(buildReadRequest(slot), SUB_DUMP_CHUNK, DUMP_CHUNK_COUNT);
      const ms = performance.now() - started;
      if (chunks.length < DUMP_CHUNK_COUNT) {
        reason = `timed out with ${chunks.length} of ${DUMP_CHUNK_COUNT} chunks`;
      } else {
        const decoded = assembleChunks(chunks);
        const problems = checkDump(chunks, decoded);
        if (problems.length === 0) {
          this.log.debug(`${label}: read OK on attempt ${attempt}, ${decoded.length} bytes in ${ms.toFixed(0)} ms`);
          return { decoded, chunks, attempt, ms };
        }
        reason = `failed sanity check: ${problems.join("; ")}`;
      }
      // Warn, not debug: re-reads are exactly the browser-vs-CLI evidence
      // the phase 1 acceptance test is looking for (DEV_JOURNAL.md Q1).
      this.log.warn(`${label}: read attempt ${attempt} of ${this.attempts} ${reason}`);
    }
    throw new ReadError(slot, reason);
  }

  _send(msg) {
    this.log.debug(`-> ${describeMessage(msg)}`);
    this.output.send(msg);
  }

  /** Send `msg`, then collect `want` distinct-offset replies with the given
   *  sub-command. Resolves with whatever arrived when complete or timed out. */
  _request(msg, sub, want) {
    if (this._waiter) throw new Error("another request is already in progress");
    return new Promise((resolve, reject) => {
      const w = { sub, want, chunks: [], offsets: new Set(), other: 0, resolve, started: performance.now() };
      w.timer = setTimeout(() => {
        this.log.debug(`(timed out after ${this.timeoutMs} ms: ${w.chunks.length}/${want} matched, ${w.other} other message(s))`);
        this._finish(w);
      }, this.timeoutMs);
      this._waiter = w;
      try {
        this._send(msg);
      } catch (e) {
        clearTimeout(w.timer);
        this._waiter = null;
        reject(e);
      }
    });
  }

  _finish(w) {
    clearTimeout(w.timer);
    if (this._waiter === w) this._waiter = null;
    w.resolve(w.chunks);
  }

  _onMessage(data) {
    const msg = data instanceof Uint8Array ? data : Uint8Array.from(data);
    if (msg.length === 0) return;
    if (msg[0] !== 0xf0) {
      // Ordinary MIDI (program change, active sensing, ...), not ours.
      this.log.debug(`<- non-sysex MIDI message: ${Array.from(msg, (b) => b.toString(16)).join(" ")}`);
      return;
    }
    if (msg[msg.length - 1] !== 0xf7) {
      // Web MIDI should deliver each SysEx message whole (DEV_JOURNAL.md Q4).
      this.log.warn(`<- SysEx message without a closing F7 (${msg.length} bytes): ${describeMessage(msg)}`);
    }
    const w = this._waiter;
    if (!w) {
      this.log.debug(`<- ${describeMessage(msg)} [unsolicited -- ignored]`);
      return;
    }
    if (!(msg.length > 12 && isSysex(msg, CMD_RESPONSE, w.sub))) {
      w.other++;
      this.log.debug(`<- ${describeMessage(msg)} [not the reply we're waiting for]`);
      return;
    }
    const off = chunkOffset(msg);
    if (w.offsets.has(off)) {
      this.log.debug(`<- ${describeMessage(msg)} [duplicate offset ${off} -- ignored]`);
      return;
    }
    w.offsets.add(off);
    w.chunks.push(msg);
    this.log.debug(`<- ${describeMessage(msg)} [MATCH ${w.chunks.length}/${w.want}]`);
    if (w.chunks.length === w.want) this._finish(w);
  }
}

/** Pick the GP-200's ports from a Web MIDI access object's port list:
 *  names containing both "gp" and "200", as the CLI's auto-detect does. */
export function findGp200Ports(ports) {
  return [...ports].filter((p) => /gp/i.test(p.name) && /200/.test(p.name));
}
