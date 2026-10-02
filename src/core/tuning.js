// Developer-only write-timing test (DEV_JOURNAL.md T1 and T2). Writes to
// the scratch slots 64A-64D, always switching a slot between two different
// patch sets so every write changes its content: a write that silently
// didn't land can't pass. Per write it measures how long the pauses really
// took and, in "poll" mode, when the pedal first answered a read after the
// upload and whether that answer already held the new patch.
//
// Pass/fail is a restore's (the same verifyWrite after the same preset
// change) plus a LATE CHECK: each write is re-read again after the test
// has moved on to other slots, because the pedal can change a byte after
// the immediate verify has passed (DEV_JOURNAL.md 2026-10-01: 0x44e/0x456,
// a 2 became 0, in 44 slots of a full restore). The late check runs at the
// end of every run (after switching to another slot and waiting
// LATE_SETTLE_MS) for writes not yet checked, plus one of (LATE_MODES):
//   - "overwrite": each slot just before it's overwritten. Adds one read
//     before each upload, i.e. a few ms in the gap after a preset change.
//   - "twoLater": each write right after the verify of the write two later
//     (3-4 patches per set). By then the pedal has switched away from the
//     slot, and the read sits after a verify, so it adds nothing between a
//     preset change and the next upload, in either order.
//   - "end": only the end of the run (each slot's last write).
// The verify is the restore's, so pedal-managed bytes (prst.js) don't fail
// it; they're recorded per write (`managedDiff`). The late check still
// reports every byte. Nothing here changes the shipped timing; the numbers
// are evidence for deciding whether to.

import { plannedWriteMs, WRITE_TIMING } from "./device.js";
import { buildPrstFromDump, DEAD_BYTE_FILE_OFFSETS, diffPrstContent, isPrst, prstFileName } from "./prst.js";
import { labelToSlot, slotToLabel } from "./slots.js";

/** Factory-default slots, safe to overwrite (a factory reset restores them). */
export const SCRATCH_SLOTS = ["64A", "64B", "64C", "64D"].map(labelToSlot);

/** Defaults: the restore's own timing (the CLI's), so a run checks what ships. */
export const TUNING_DEFAULTS = {
  mode: "fixed", cycles: 4, ...WRITE_TIMING, betweenSlotsMs: 300, pollTimeoutMs: 500, pollMaxMs: 5000,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pause after the final switch before the end-of-run late check. */
export const LATE_SETTLE_MS = 1000;

/** When writes are late-checked besides the end of the run (see the top of this file). */
export const LATE_MODES = ["overwrite", "twoLater", "end"];
const LATE_HEADER = {
  overwrite: "late check before each overwrite and at the end",
  twoLater: "late check two writes later (after that write's verify) and at the end",
  end: "late check at the end only",
};

/** Mismatches as "0x456:2->0 ...", at most `max` of them. */
export function formatDiffs(diffs, max = Infinity) {
  const shown = diffs.slice(0, max).map((m) => `0x${m.off.toString(16)}:${m.expected}->${m.actual}`).join(" ");
  return diffs.length > max ? `${shown} (+${diffs.length - max} more)` : shown;
}

/** At most this many offsets per "other" poll reply in the log and CSV. */
const OTHER_DIFF_MAX = 20;

/** Same patch as far as a verify can tell (device-owned and dead bytes ignored). */
export function sameContent(a, b) {
  return diffPrstContent(a, b, DEAD_BYTE_FILE_OFFSETS).length === 0;
}

/**
 * Problems with the two picked sets, in plain language (empty = OK).
 * Item i of each set goes to SCRATCH_SLOTS[i].
 */
export function checkTuningSets(setX, setY) {
  if (!setX.length || !setY.length) return ["Pick files for both set X and set Y."];
  if (setX.length !== setY.length) return [`Set X has ${setX.length} patch(es) and set Y has ${setY.length}; they must match.`];
  if (setX.length > SCRATCH_SLOTS.length) return [`At most ${SCRATCH_SLOTS.length} patches per set (the scratch slots are 64A-64D).`];
  const problems = [];
  for (const [name, set] of [["X", setX], ["Y", setY]]) {
    for (const e of set) if (!isPrst(e.data)) problems.push(`Set ${name}: ${e.name} is not a valid .prst file.`);
  }
  if (problems.length) return problems;
  setX.forEach((x, i) => {
    if (sameContent(x.data, setY[i].data)) {
      problems.push(`${x.name} (X) and ${setY[i].name} (Y) are the same patch, so writing one over the other ` +
        "can't show whether the write landed. Pick different patches.");
    }
  });
  return problems;
}

/**
 * Run the test. Reads the scratch slots first, then does `cycles` writes to
 * each, every write choosing whichever set differs from what the slot holds.
 * @param {import("./device.js").GP200} device
 * @param {object} o
 * @param {{name: string, data: Uint8Array}[]} o.setX
 * @param {{name: string, data: Uint8Array}[]} o.setY
 * @param {"fixed"|"poll"} o.mode fixed: settle, preset change, verify (a
 *   restore). poll: settle, then read until the new patch appears (bounded
 *   by pollMaxMs), then the same preset change and verify.
 * @param {boolean} [o.verifyBeforeSwitch] verify before the preset change
 *   instead of after it, so nothing is sent between the preset change and
 *   the next upload: the order of the withdrawn fast restore (commit
 *   540109f), which the default order can't reproduce because its verify
 *   read lands right after the switch
 * @param {"overwrite"|"twoLater"|"end"} [o.late] when to late-check
 *   besides the end of the run; "twoLater" needs 3-4 patches per set
 * @param {number} [o.lateSettleMs] pause before the end-of-run late check
 * @param {(sinceMs: number) => boolean} [o.wasHidden] see writeSlots
 * @returns {Promise<{rows: object[], summary: object, cancelled: boolean}>}
 */
export async function runTuning(device, {
  setX, setY, mode = TUNING_DEFAULTS.mode, cycles = TUNING_DEFAULTS.cycles, timing, betweenSlotsMs = 300,
  pollTimeoutMs = TUNING_DEFAULTS.pollTimeoutMs, pollMaxMs = TUNING_DEFAULTS.pollMaxMs,
  verifyBeforeSwitch = false, late = "overwrite", lateSettleMs = LATE_SETTLE_MS,
  skeleton, log, wasHidden = () => false, isCancelled = () => false, onProgress = () => {},
}) {
  const problems = checkTuningSets(setX, setY);
  if (problems.length) throw new Error(problems.join(" "));
  if (!LATE_MODES.includes(late)) throw new Error(`Unknown late-check mode "${late}".`);
  if (late === "twoLater" && setX.length < 3) {
    throw new Error("The late check two writes later needs 3 or 4 patches per set; with fewer, " +
      "the write two later would overwrite the slot before it's checked.");
  }
  const slots = SCRATCH_SLOTS.slice(0, setX.length);
  const total = cycles * slots.length;
  if (verifyBeforeSwitch && late === "overwrite") {
    log.warn("Timing test: the late check before each overwrite reads the next slot right after the preset change, " +
      "so with verify before the switch there is still a read in that gap. Choose another late check to test the fast restore's order.");
  }
  log.info(`Timing test: ${mode} mode, ${cycles} write(s) to each of ${slots.map(slotToLabel).join(", ")} (${total} in all); ` +
    `chunk gap ${timing.chunkGapMs} ms, settle ${timing.settleMs} ms, after preset change ${timing.presetChangeMs} ms, ` +
    `between patches ${betweenSlotsMs} ms` + (mode === "poll" ? `, poll timeout ${pollTimeoutMs} ms, poll limit ${pollMaxMs} ms` : "") +
    (verifyBeforeSwitch ? "; verify BEFORE the preset change (fast restore's order)" : "") +
    `; ${LATE_HEADER[late]}`);

  const current = [];
  for (const slot of slots) {
    const { decoded } = await device.readDump(slot); // a ReadError stops the test before any write
    current.push(buildPrstFromDump(decoded, skeleton));
    log.info(`${slotToLabel(slot)} holds "${prstFileName(current.at(-1))}" before the test`);
  }

  const rows = [];
  const lastRow = []; // per slot: the row of the latest write, awaiting its late check
  let cancelled = false;
  outer: for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < slots.length; i++) {
      if (isCancelled()) {
        cancelled = true;
        log.warn(`Timing test stopped after ${rows.length} of ${total} writes`);
        break outer;
      }
      if (late === "overwrite" && lastRow[i]) {
        const now = await lateCheck(device, slots[i], lastRow[i], "before overwrite", skeleton, log);
        if (now) current[i] = now;
      }
      // X unless the slot already holds X. After a failed write the slot
      // still holds its old patch, so this still picks a different one.
      const useY = sameContent(current[i], setX[i].data);
      const entry = useY ? setY[i] : setX[i];
      const twoBack = late === "twoLater" ? rows.at(-2) : undefined;
      const afterVerify = twoBack && (async () => {
        const now = await lateCheck(device, twoBack.slot, twoBack, "two writes later", skeleton, log);
        if (now) current[slots.indexOf(twoBack.slot)] = now;
      });
      const row = await tuneOneWrite(device, {
        slot: slots[i], entry, set: useY ? "Y" : "X", previous: current[i], mode, timing,
        pollTimeoutMs, pollMaxMs, verifyBeforeSwitch, skeleton, wasHidden, afterVerify,
      });
      row.lateMode = late;
      row.n = rows.length + 1;
      rows.push(row);
      lastRow[i] = row;
      log[row.verified ? "info" : "error"](describeRow(row));
      if (row.roundtrip) current[i] = row.roundtrip; // what the pedal really holds now
      onProgress({ done: rows.length, total, row });
      if (rows.length < total) await sleep(betweenSlotsMs);
    }
  }
  const unchecked = lastRow.filter((r) => r && !r.late);
  if (unchecked.length) {
    // End of run: after the usual between-writes pause (so the last slot
    // gets the same treatment as the others), switch to another scratch
    // slot so every written slot has been left, let the pedal settle, then
    // re-read each slot whose latest write hasn't been late-checked yet.
    await sleep(betweenSlotsMs);
    const last = rows.at(-1).slot;
    const away = slots.find((s) => s !== last) ?? SCRATCH_SLOTS.find((s) => s !== last);
    log.info(`Late check: switching to ${slotToLabel(away)}, waiting ${lateSettleMs} ms, then re-reading ` +
      unchecked.map((r) => `${r.label} (#${r.n})`).join(", "));
    await device.selectSlot(away, { ...timing, presetChangeMs: 0 });
    await sleep(lateSettleMs);
    for (const r of unchecked) await lateCheck(device, r.slot, r, "end of run", skeleton, log);
  }
  const summary = summarizeTuning(rows);
  for (const line of describeSummary(summary, mode)) log.info(line);
  return { rows, summary, cancelled };
}

/**
 * Re-read `slot` and compare it with the file its latest write (`row`)
 * sent; record the outcome on that row. Returns what the slot holds now
 * (as a .prst), or null if the read failed.
 */
async function lateCheck(device, slot, row, when, skeleton, log) {
  row.lateWhen = when;
  let now;
  try {
    now = buildPrstFromDump((await device.readDump(slot)).decoded, skeleton);
  } catch (e) {
    row.late = "read failed";
    row.lateDiff = e.reason ?? String(e);
    log.error(`Late check #${row.n} ${row.label} (${when}): couldn't read it (${row.lateDiff})`);
    return null;
  }
  const diffs = diffPrstContent(row.data, now, DEAD_BYTE_FILE_OFFSETS);
  row.late = diffs.length ? "CHANGED" : "ok";
  row.lateDiff = formatDiffs(diffs);
  if (diffs.length) {
    log.error(`Late check #${row.n} ${row.label} "${row.patch}" (${when}): CHANGED since it was written ` +
      `(${row.verified ? "its verify had passed" : "its verify had failed"}): ${row.lateDiff}`);
  } else {
    log.debug(`Late check #${row.n} ${row.label} (${when}): still as written`);
  }
  return now;
}

/** Run `fn` (if any); how long it took, in ms. */
async function timed(fn) {
  if (!fn) return 0;
  const t = performance.now();
  await fn();
  return performance.now() - t;
}

async function tuneOneWrite(device, {
  slot, entry, set, previous, mode, timing, pollTimeoutMs, pollMaxMs, verifyBeforeSwitch, skeleton, wasHidden, afterVerify,
}) {
  const t0 = performance.now();
  const row = {
    slot, data: entry.data, late: "", lateWhen: "", lateDiff: "",
    label: slotToLabel(slot), set, file: entry.name, patch: prstFileName(entry.data), mode, verifyBeforeSwitch,
    chunkGapMs: timing.chunkGapMs, settleMs: timing.settleMs, presetChangeMs: timing.presetChangeMs,
    plannedMs: plannedWriteMs(timing),
    polls: 0, firstReply: null, firstReplyMs: null, newAtMs: null, pollTrace: "", otherDiff: "", otherDiffLast: "",
  };
  row.burstMs = await device.sendUpload(slot, entry.data, timing);
  const tBurst = performance.now();
  await sleep(timing.settleMs);
  row.settleActualMs = performance.now() - tBurst;
  if (mode === "poll") {
    Object.assign(row, await pollUntilNew(device, slot, entry.data, previous, skeleton, tBurst, { pollTimeoutMs, pollMaxMs }));
  }
  let v;
  let lateMs = 0; // another write's late check, kept out of this write's times
  if (verifyBeforeSwitch) {
    row.writeMs = performance.now() - t0;
    v = await device.verifyWrite(slot, entry.data, skeleton);
    lateMs = await timed(afterVerify);
    await device.selectSlot(slot, timing);
  } else {
    await device.selectSlot(slot, timing);
    row.writeMs = performance.now() - t0; // everything before the verify
    v = await device.verifyWrite(slot, entry.data, skeleton);
    lateMs = await timed(afterVerify);
  }
  row.verified = v.ok;
  row.rechecked = v.recheckedAfterMismatch;
  row.reason = (v.reason ?? "") + (v.mismatches?.length ? `: ${formatDiffs(v.mismatches, OTHER_DIFF_MAX)}` : "");
  row.managedDiff = formatDiffs(v.managed ?? []);
  row.roundtrip = v.roundtrip;
  row.totalMs = performance.now() - t0 - lateMs;
  row.hidden = wasHidden(t0);
  return row;
}

/**
 * Read `slot` repeatedly from the end of the upload burst until it holds
 * `expected` or `pollMaxMs` has passed. Each answer is classed as the new
 * patch, the old one, or "other" (neither: a partial commit, or chunks from
 * two replies mixed after a timed-out poll). For "other" answers, records
 * where the first and the last one differed from the new patch
 * (`otherDiff`; `otherDiffLast` only if it differs from the first).
 */
async function pollUntilNew(device, slot, expected, previous, skeleton, tBurst, { pollTimeoutMs, pollMaxMs }) {
  const out = { polls: 0, firstReply: "none", firstReplyMs: null, newAtMs: null, otherDiff: "", otherDiffLast: "" };
  let lastOther = "";
  const trace = [];
  while (performance.now() - tBurst < pollMaxMs) {
    const r = await device.readOnce(slot, pollTimeoutMs);
    out.polls++;
    const at = Math.round(performance.now() - tBurst);
    if (!r.ok) {
      trace.push(`${at}:${r.got}/7`);
      continue;
    }
    const got = buildPrstFromDump(r.decoded, skeleton);
    const kind = sameContent(got, expected) ? "new" : sameContent(got, previous) ? "old" : "other";
    trace.push(`${at}:${kind}`);
    if (kind === "other") {
      lastOther = formatDiffs(diffPrstContent(expected, got, DEAD_BYTE_FILE_OFFSETS), OTHER_DIFF_MAX);
      if (!out.otherDiff) out.otherDiff = lastOther;
    }
    if (out.firstReplyMs === null) Object.assign(out, { firstReply: kind, firstReplyMs: at });
    if (kind === "new") {
      out.newAtMs = at;
      break;
    }
  }
  if (lastOther !== out.otherDiff) out.otherDiffLast = lastOther;
  out.pollTrace = trace.join(" ");
  return out;
}

function describeRow(r) {
  const s = (ms) => `${Math.round(ms)} ms`;
  let text = `#${r.n} ${r.label} <- set ${r.set} "${r.patch}": ${r.verified ? "verified" : `NOT VERIFIED (${r.reason})`}` +
    `${r.rechecked ? " after a re-read" : ""}; burst ${s(r.burstMs)}, settle ${s(r.settleActualMs)}, ` +
    `write ${s(r.writeMs)} (planned ${s(r.plannedMs)}), with verify ${s(r.totalMs)}`;
  if (r.mode === "poll") {
    text += r.firstReplyMs === null
      ? `; no reply to ${r.polls} poll(s)`
      : `; first reply at ${r.firstReplyMs} ms after the burst was ${r.firstReply}, ` +
        (r.newAtMs === null ? "new patch never seen" : `new patch at ${r.newAtMs} ms`) +
        (r.otherDiff ? `; "other" replies differed from the new patch at ${r.otherDiff}` +
          (r.otherDiffLast ? `, the last one at ${r.otherDiffLast}` : "") : "") +
        ` [${r.pollTrace}]`;
  }
  if (r.managedDiff) text += `; pedal-managed byte(s) at the verify: ${r.managedDiff}`;
  return text + (r.hidden ? "; PAGE WAS HIDDEN" : "");
}

function stats(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return { min: v[0], median, max: v.at(-1) };
}

/** Counts and timing statistics over all rows. */
export function summarizeTuning(rows) {
  const polled = rows.filter((r) => r.mode === "poll");
  const firstReply = {};
  for (const r of polled) firstReply[r.firstReply] = (firstReply[r.firstReply] ?? 0) + 1;
  return {
    writes: rows.length,
    notVerified: rows.filter((r) => !r.verified).length,
    rechecked: rows.filter((r) => r.rechecked).length,
    hidden: rows.filter((r) => r.hidden).length,
    writeMs: stats(rows.map((r) => r.writeMs)),
    totalMs: stats(rows.map((r) => r.totalMs)),
    polled: polled.length,
    firstReply,
    firstReplyMs: stats(polled.filter((r) => r.firstReplyMs !== null).map((r) => r.firstReplyMs)),
    newAtMs: stats(polled.filter((r) => r.newAtMs !== null).map((r) => r.newAtMs)),
    neverNew: polled.filter((r) => r.newAtMs === null).length,
    lateChecked: rows.filter((r) => r.late === "ok" || r.late === "CHANGED").length,
    lateChanged: rows.filter((r) => r.late === "CHANGED").map((r) => `#${r.n} ${r.label}`),
    lateChangedAfterVerify: rows.filter((r) => r.late === "CHANGED" && r.verified).length,
    lateUnread: rows.filter((r) => r.late === "read failed").length,
  };
}

/** The summary as log lines. */
export function describeSummary(s, mode) {
  const st = (x) => (x ? `min ${Math.round(x.min)}, median ${Math.round(x.median)}, max ${Math.round(x.max)} ms` : "n/a");
  const lines = [
    `Timing test result: ${s.writes} write(s), ${s.notVerified} NOT verified, ${s.rechecked} needed a confirming re-read, ` +
      `${s.hidden} while the page was hidden`,
    `  write (before verify): ${st(s.writeMs)}; with verify: ${st(s.totalMs)}`,
    `  late check: ${s.lateChecked} of ${s.writes} write(s) re-read after moving on; ` +
      (s.lateChanged.length
        ? `${s.lateChanged.length} CHANGED (${s.lateChangedAfterVerify} of them had passed verify): ${s.lateChanged.join(", ")}`
        : "none changed") +
      (s.lateUnread ? `; ${s.lateUnread} couldn't be read` : ""),
  ];
  if (mode === "poll" || s.polled) {
    const kinds = Object.entries(s.firstReply).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
    lines.push(`  first reply after the burst: ${st(s.firstReplyMs)}; it held: ${kinds}`);
    lines.push(`  new patch seen at: ${st(s.newAtMs)}; never seen within the limit: ${s.neverNew}`);
  }
  return lines;
}

const CSV_COLUMNS = [
  "n", "label", "set", "file", "patch", "mode", "chunkGapMs", "settleMs", "presetChangeMs", "plannedMs",
  "burstMs", "settleActualMs", "writeMs", "totalMs", "polls", "firstReply", "firstReplyMs", "newAtMs",
  "pollTrace", "verified", "rechecked", "hidden", "reason", "late", "lateWhen", "lateDiff",
  "otherDiff", "otherDiffLast", "verifyBeforeSwitch", "lateMode", "managedDiff",
];

/** One row per write, for pasting into a spreadsheet or the journal. */
export function tuningCsv(rows) {
  const cell = (v) => {
    const s = typeof v === "number" ? String(Math.round(v)) : String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}
