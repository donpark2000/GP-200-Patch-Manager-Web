// The GP-200 from the command line: backup (reads only) and restore.
// Developer, 2026-11-24: Claude's runner may write GP-200 patches ("remove
// the block, safely: the web app's write is well tested"). So restore here is
// the web app's own restore, unchanged: src/core's GP200.connect() (identity
// query, editor mode), planUpload() and writeSlots() (fast pacing: upload,
// read back until it matches, preset change). What's added is only care:
// - every message goes through patchWriteGate(): reads, the identity query
//   and editor mode, and uploads and preset changes to the planned slots
//   only; anything else is refused before it reaches the pedal;
// - midi_bridge.py sends GP-200 uploads only when opened with
//   --gp200-patch-writes, and never anything but those message kinds;
// - a slot is overwritten only if it still holds what the reference backup
//   has for it (read just before writing), as the GP-50 runner does;
// - the written slots are read again at the end, and must still match.

import { GP200, WRITE_TIMING } from "../../src/core/device.js";
import { readSlots } from "../../src/core/export.js";
import { diffPrstContent, DEAD_BYTE_FILE_OFFSETS, splitManaged } from "../../src/core/prst.js";
import { skeletonBytes } from "../../src/core/skeleton.js";
import { slotToLabel, TOTAL_SLOTS } from "../../src/core/slots.js";
import {
  buildEnterEditorMode, buildIdentityQuery, buildPresetChange, CMD_RESPONSE, HEADER, nibbleDecode, SUB_UPLOAD_CHUNK, toHex,
} from "../../src/core/sysex.js";
import { expandSources, orderEntries, parseLeadingSlotLabel, planUpload, planWarnings, writeSlots } from "../../src/core/upload.js";
import { isGp200Read } from "./copy.js";

const UPLOAD_CHUNK_RAW = 183; // as src/core/sysex.js buildUploadChunks
const UPLOAD_CHUNKS = 7; // a 1224-byte .prst is 1184 bytes uploaded: 7 chunks
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const hex12 = (m) => toHex(m.slice(0, 12));

/**
 * The GP-200's output with every message checked against the plan: reads,
 * the identity query, enter editor mode, and for the slots in `slots` only,
 * whole uploads (7 chunks in order, the slot named inside the first) and
 * preset changes. Anything else throws and never reaches the pedal.
 */
export function patchWriteGate(output, slots) {
  const allowed = new Set(slots);
  const fixed = [buildIdentityQuery(), buildEnterEditorMode()];
  let upload = null; // { slot, next offset }
  const refuse = (why, m) => { throw new Error(`Refused to send to the GP-200: ${why} (${hex12(m)})`); };
  return {
    send: (msg) => {
      const m = Uint8Array.from(msg);
      const isUpload = m.length > 13 && HEADER.every((b, i) => m[i] === b) && m[8] === CMD_RESPONSE && m[9] === SUB_UPLOAD_CHUNK;
      if (upload && !isUpload) refuse(`an upload to ${slotToLabel(upload.slot)} is unfinished`, m);
      if (isUpload) {
        if (m[10] !== 0x09) refuse("an upload chunk without the 0x09 marker", m);
        const off = m[11] | (m[12] << 7);
        if (off === 0) {
          if (upload) refuse(`a new upload before the one to ${slotToLabel(upload.slot)} finished`, m);
          const head = nibbleDecode(m.subarray(13, m.length - 1)).subarray(0, 14);
          const s = head[6];
          if (!same([...head], [0, 0, 4, 0, 1, 0, s, 0, 1, 0, 4, 0, s, 0])) refuse("an upload whose header isn't the known one", m);
          if (!allowed.has(s)) refuse(`an upload to ${slotToLabel(s)}, which isn't in the plan`, m);
          upload = { slot: s, next: UPLOAD_CHUNK_RAW, count: 1 };
        } else {
          if (!upload || off !== upload.next) refuse(`an upload chunk out of order (offset ${off})`, m);
          upload.next += UPLOAD_CHUNK_RAW;
          upload.count++;
        }
        if (upload.count === UPLOAD_CHUNKS) upload = null;
        output.send(msg);
        return;
      }
      if (isGp200Read(m) || fixed.some((f) => same(f, m))) { output.send(msg); return; }
      for (const s of allowed) if (same(buildPresetChange(s), m)) { output.send(msg); return; }
      refuse("not a read, nor an upload or preset change to a planned slot", m);
    },
  };
}

/** Back up GP-200 slots (numbers) with reads only, as the app's Back up does. */
export async function gp200Backup(connection, slots, { log, isCancelled, timeoutMs }) {
  const device = new GP200({ input: connection.input, output: patchWriteGate(connection.output, []), log, ...(timeoutMs ? { timeoutMs } : {}) });
  try {
    return await readSlots(device, slots, { skeleton: skeletonBytes(), log, isCancelled });
  } finally {
    device.close();
  }
}

/** Reference backup (zip entries named "34A_Name.prst") as slot -> .prst. */
export function gp200Reference(entries) {
  const bySlot = new Map();
  for (const [name, data] of entries) {
    if (!name.toLowerCase().endsWith(".prst")) continue;
    const s = parseLeadingSlotLabel(name);
    if (s === null) throw new Error(`Reference: "${name}" doesn't start with a GP-200 slot label`);
    bySlot.set(s, data);
  }
  return bySlot;
}

/** Differences that matter between two .prst exports: the write verify's rule. */
function differs(a, b) {
  return splitManaged(diffPrstContent(a, b, DEAD_BYTE_FILE_OFFSETS)).other.length > 0;
}

/**
 * Restore `files` (.prst files or one zip) to the GP-200 from `start`, the
 * app's way, guarded as the header says. Returns { ok, results }.
 */
export async function gp200Restore(connection, files, start, reference, { log, isCancelled = () => false, timing = WRITE_TIMING, timeoutMs }) {
  const { entries, notes } = await expandSources(files);
  for (const n of notes) log.warn(n);
  const { ordered, orderedBy } = orderEntries(entries);
  const plan = planUpload(ordered, start);
  log.info(`Plan (ordered by ${orderedBy}): ${plan.items.map((it) => `${it.fileName} -> ${it.label}`).join("; ")}`);
  for (const w of planWarnings(plan)) log.warn(w);
  if (plan.skipped.length || plan.overflow.length || !plan.items.length) {
    log.error("Nothing written: every file must be a valid .prst that fits before 64-D");
    return { ok: false, results: [] };
  }
  const slots = plan.items.map((it) => it.slot);
  const missing = slots.filter((s) => !reference.has(s));
  if (missing.length) {
    log.error(`Nothing written: the reference has no patch for ${missing.map(slotToLabel).join(", ")}`);
    return { ok: false, results: [] };
  }
  const device = new GP200({ input: connection.input, output: patchWriteGate(connection.output, slots), log, timing, ...(timeoutMs ? { timeoutMs } : {}) });
  try {
    // The slots must still hold what the reference says, read just before writing.
    const before = await readSlots(device, slots, { skeleton: skeletonBytes(), log, isCancelled });
    const now = new Map(before.entries.map((e) => [e.slot, e.data]));
    const changed = slots.filter((s) => !now.has(s) || differs(reference.get(s), now.get(s)));
    if (changed.length) {
      log.error(`Nothing written: ${changed.map(slotToLabel).join(", ")} no longer hold${changed.length === 1 ? "s" : ""} what the reference has (or couldn't be read)`);
      return { ok: false, results: [] };
    }
    log.info(`${slots.length} slot(s) hold what the reference has; writing`);
    await device.connect();
    const out = await writeSlots(device, plan.items, { skeleton: skeletonBytes(), log, isCancelled });
    if (out.failed.length || out.cancelled) return { ok: false, results: out.results };
    // End state: read every written slot again; each must still match its file.
    const after = await readSlots(device, slots, { skeleton: skeletonBytes(), log, isCancelled });
    const got = new Map(after.entries.map((e) => [e.slot, e.data]));
    const bad = plan.items.filter((it) => !got.has(it.slot) || differs(it.data, got.get(it.slot)));
    if (bad.length) log.error(`End check: ${bad.map((it) => it.label).join(", ")} no longer match${bad.length === 1 ? "es" : ""} the file written`);
    else log.info(`End check: all ${plan.items.length} written slot(s) read again and match their files`);
    return { ok: bad.length === 0, results: out.results };
  } finally {
    device.close();
  }
}

export const ALL_GP200_SLOTS = Array.from({ length: TOTAL_SLOTS }, (_, i) => i);
