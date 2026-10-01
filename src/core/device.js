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
  buildPresetChange,
  buildReadRequest,
  buildUploadChunks,
  buildUploadImage,
  chunkOffset,
  chunkPayload,
  CMD_RESPONSE,
  describeMessage,
  DUMP_CHUNK_COUNT,
  isSysex,
  SUB_DUMP_CHUNK,
  SUB_IDENTITY_REPLY,
} from "./sysex.js";
import {
  buildPrstFromDump,
  DEAD_BYTE_FILE_OFFSETS,
  diffPrstContent,
  MIN_DUMP_LEN,
  prstFileName,
} from "./prst.js";
import { slotToLabel } from "./slots.js";

export const READ_TIMEOUT_MS = 2000; // same budget as the CLI's READ_TIMEOUT_S
export const READ_ATTEMPTS = 3;

/** The CLI's write_slot pacing: 40 ms between chunks (RigSheet's spacing),
 *  a 1 s settle, a preset change, 300 ms. Kept as the reference for the
 *  timing test; the restore no longer uses it. */
export const CLI_WRITE_TIMING = { chunkGapMs: 40, settleMs: 1000, presetChangeMs: 300 };

/**
 * Restore pacing. The pedal sends no write ACK, so the CLI waited fixed
 * times. Here the read-back is the ACK instead: send all 7 chunks at once,
 * read the slot until it holds the new patch (each read waits up to
 * `readBackTimeoutMs`, re-reads `readBackRetryMs` apart, giving up after
 * `readBackLimitMs`), then the preset change. Hardware evidence for every
 * zero is in DEV_JOURNAL.md (2026-09-30 and 10-01, T2): 516 writes with no
 * settle, 200 of them with no pause anywhere, all verified, the slot switch
 * obeyed, and the patches intact after a power cycle. The pedal answered
 * with the new patch 12-155 ms after the upload, depending on the patch.
 * With no pauses there are no timers for a hidden tab to slow (T1).
 */
export const WRITE_TIMING = {
  chunkGapMs: 0, settleMs: 0, presetChangeMs: 0,
  readBackTimeoutMs: 500, readBackRetryMs: 25, readBackLimitMs: 3000,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The fixed pauses in one write with `timing` (the read-back comes on top). */
export function plannedWriteMs({ chunkGapMs, settleMs, presetChangeMs }) {
  return 7 * chunkGapMs + settleMs + presetChangeMs;
}

/**
 * A warning when a write took much longer than its fixed pauses (at least
 * twice as long and 500 ms over), else null. Causes: a slow read-back, or a
 * hidden tab, where Chrome slows timers (DEV_JOURNAL.md T1).
 */
export function slowWriteWarning(label, { totalMs, plannedMs }, wasHidden = false) {
  if (totalMs < plannedMs * 2 || totalMs < plannedMs + 500) return null;
  return `${label}: the write took ${(totalMs / 1000).toFixed(1)} s` +
    (plannedMs ? `, planned ${(plannedMs / 1000).toFixed(1)} s` : "") +
    (wasHidden ? " (the page was hidden, which can slow the browser's timers)" : "");
}

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
   * @param {typeof WRITE_TIMING} [opts.timing]
   */
  constructor({ input, output, log, timeoutMs = READ_TIMEOUT_MS, attempts = READ_ATTEMPTS, timing = WRITE_TIMING }) {
    this.input = input;
    this.output = output;
    this.log = log;
    this.timeoutMs = timeoutMs;
    this.attempts = attempts;
    this.timing = timing;
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
      const r = await this.readOnce(slot);
      if (r.ok) {
        this.log.debug(`${label}: read OK on attempt ${attempt}, ${r.decoded.length} bytes in ${r.ms.toFixed(0)} ms`);
        return { decoded: r.decoded, chunks: r.chunks, attempt, ms: r.ms };
      }
      reason = r.reason;
      // Warn, not debug: re-reads are exactly the browser-vs-CLI evidence
      // the phase 1 acceptance test is looking for (DEV_JOURNAL.md Q1).
      this.log.warn(`${label}: read attempt ${attempt} of ${this.attempts} ${reason}`);
    }
    throw new ReadError(slot, reason);
  }

  /**
   * One read attempt, no retries and no warnings: readDump's building block,
   * also used by the timing experiment to poll right after a write.
   * @returns {Promise<{ok: true, decoded: Uint8Array, chunks: Uint8Array[], ms: number}
   *   | {ok: false, reason: string, got: number, ms: number}>}
   */
  async readOnce(slot, timeoutMs = this.timeoutMs) {
    const started = performance.now();
    const chunks = await this._request(buildReadRequest(slot), SUB_DUMP_CHUNK, DUMP_CHUNK_COUNT, timeoutMs);
    const ms = performance.now() - started;
    if (chunks.length < DUMP_CHUNK_COUNT) {
      return { ok: false, reason: `timed out with ${chunks.length} of ${DUMP_CHUNK_COUNT} chunks`, got: chunks.length, ms };
    }
    const decoded = assembleChunks(chunks);
    const problems = checkDump(chunks, decoded);
    if (problems.length) return { ok: false, reason: `failed sanity check: ${problems.join("; ")}`, got: chunks.length, ms };
    return { ok: true, decoded, chunks, ms };
  }

  /**
   * Restore one .prst file to `slot`: flash upload (the CLI's write_slot,
   * without its experimental save-commit), read back until the slot holds
   * it (verifyWrite), then a preset change, which leaves the pedal on
   * `slot`. Only called from the restore feature, after the user confirms.
   * @returns the verifyWrite result, plus `uploadMs` and `totalMs`
   */
  async writeSlot(slot, fileBytes, skeleton) {
    const t0 = performance.now();
    const uploadMs = await this.sendUpload(slot, fileBytes);
    if (this.timing.settleMs > 0) await sleep(this.timing.settleMs);
    const v = await this.verifyWrite(slot, fileBytes, skeleton);
    await this.selectSlot(slot);
    return { ...v, uploadMs, totalMs: performance.now() - t0 };
  }

  /** The 7 upload chunks with `chunkGapMs` after each. Returns elapsed ms.
   *  A gap of 0 sends all 7 at once with no timer at all (a 0 ms timer
   *  still pauses about 4 ms in browsers), the case a hidden tab can't slow. */
  async sendUpload(slot, fileBytes, timing = this.timing) {
    const t0 = performance.now();
    for (const c of buildUploadChunks(buildUploadImage(fileBytes, slot))) {
      this._send(c);
      if (timing.chunkGapMs > 0) await sleep(timing.chunkGapMs);
    }
    return performance.now() - t0;
  }

  /** Preset change to `slot` (loads the written copy), then `presetChangeMs`. */
  async selectSlot(slot, timing = this.timing) {
    this._send(buildPresetChange(slot));
    if (timing.presetChangeMs > 0) await sleep(timing.presetChangeMs);
  }

  /**
   * Read `slot` back until it matches the file that was written, ignoring
   * the device-owned bytes and the dead bytes (the CLI's verify_write_full).
   * The read-back doubles as the write ACK the pedal doesn't send: on
   * hardware the first read has always matched, 12-155 ms after the upload.
   * A failed or mismatching read is retried (at least once, then until
   * `readBackLimitMs`), so read noise or a slow save can't pose as a failed
   * write; a write that really didn't land still fails, with the last
   * mismatches. Never rewrites anything itself.
   * @returns {Promise<{ok: boolean, mismatches: {off: number, expected: number, actual: number}[],
   *   deviceName: string|null, roundtrip: Uint8Array|null, reason?: string, recheckedAfterMismatch: boolean,
   *   reads: number, readBackMs: number}>}
   */
  async verifyWrite(slot, fileBytes, skeleton) {
    const label = slotToLabel(slot);
    const { readBackTimeoutMs, readBackRetryMs, readBackLimitMs } = { ...WRITE_TIMING, ...this.timing };
    const started = performance.now();
    const elapsed = () => performance.now() - started;
    let recheckedAfterMismatch = false;
    let last = null;
    let reason = "";
    let reads = 0;
    while (reads < 2 || elapsed() < readBackLimitMs) {
      if (reads > 0 && readBackRetryMs > 0) await sleep(readBackRetryMs);
      reads++;
      const r = await this.readOnce(slot, readBackTimeoutMs);
      if (!r.ok) {
        reason = r.reason;
        this.log.debug(`${label}: read-back ${reads} ${reason}`);
        continue;
      }
      const roundtrip = buildPrstFromDump(r.decoded, skeleton);
      const mismatches = diffPrstContent(fileBytes, roundtrip, DEAD_BYTE_FILE_OFFSETS);
      last = { mismatches, deviceName: prstFileName(roundtrip), roundtrip };
      if (mismatches.length === 0) {
        const readBackMs = elapsed();
        if (reads > 1) {
          // Info, not a warning: a slow save is normal; the restore summary counts these.
          this.log.info(`${label}: matched on read-back ${reads}, after ${readBackMs.toFixed(0)} ms` +
            (recheckedAfterMismatch ? " (earlier reads differed: read noise or a slow save, not a failed write)" : ""));
        }
        return { ok: true, ...last, recheckedAfterMismatch, reads, readBackMs };
      }
      reason = `${mismatches.length} byte(s) differ from the file`;
      if (!recheckedAfterMismatch) {
        this.log.info(`${label}: read-back differs in ${mismatches.length} byte(s); re-reading for up to ` +
          `${(readBackLimitMs / 1000).toFixed(0)} s to rule out read noise or a slow save`);
        recheckedAfterMismatch = true;
      }
    }
    return {
      ok: false, mismatches: last?.mismatches ?? [], deviceName: last?.deviceName ?? null, roundtrip: last?.roundtrip ?? null,
      reason, recheckedAfterMismatch, reads, readBackMs: elapsed(),
    };
  }

  _send(msg) {
    this.log.debug(`-> ${describeMessage(msg)}`);
    this.output.send(msg);
  }

  /** Send `msg`, then collect `want` distinct-offset replies with the given
   *  sub-command. Resolves with whatever arrived when complete or timed out. */
  _request(msg, sub, want, timeoutMs = this.timeoutMs) {
    if (this._waiter) throw new Error("another request is already in progress");
    return new Promise((resolve, reject) => {
      const w = { sub, want, chunks: [], offsets: new Set(), other: 0, resolve, started: performance.now() };
      w.timer = setTimeout(() => {
        this.log.debug(`(timed out after ${timeoutMs} ms: ${w.chunks.length}/${want} matched, ${w.other} other message(s))`);
        this._finish(w);
      }, timeoutMs);
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
