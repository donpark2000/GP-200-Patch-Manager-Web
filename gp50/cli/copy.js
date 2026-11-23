// Copying between the pedals from the command line (stage 3, DESIGN.md "Both
// pedals"): read GP-200 patches (reads only: CLAUDE.md allows no GP-200
// write from the runner), convert them, and hand them to restore() for the
// GP-50; or convert files either way, for the app's Restore screen. Every
// conversion is saved with a sheet of what it changed, for the listening test.

import { GP200 } from "../../src/core/device.js";
import { readSlots } from "../../src/core/export.js";
import { skeletonBytes } from "../../src/core/skeleton.js";
import { slotToLabel } from "../../src/core/slots.js";
import { CMD_REQUEST, HEADER } from "../../src/core/sysex.js";
import { slotFileName } from "../backup.js";
import { gp200ToGp50, gp50ToGp200 } from "../convert.js";
import { fileKind } from "../restore.js";

// The GP-200 messages the runner may send: identity query (0x04), dump read
// (0x10), name read (0x20). Never enter editor mode (0x12), an upload or a
// preset change. midi_bridge.py --pedal gp200 refuses the same.
const GP200_READS = new Set([0x04, 0x10, 0x20]);

export function isGp200Read(msg) {
  return msg.length > 10 && HEADER.every((b, i) => msg[i] === b) && msg[8] === CMD_REQUEST && GP200_READS.has(msg[9]);
}

/** The GP-200's output with every message checked: anything but a read is refused, and never reaches the pedal. */
export function readOnly(output) {
  return {
    send: (msg) => {
      if (!isGp200Read(msg)) throw new Error(`Refused to send to the GP-200: not a read (${Array.from(msg.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join(" ")})`);
      output.send(msg);
    },
  };
}

/** Read GP-200 slots (numbers 0-255) as .prst files, as the app's backup builds them. */
export async function readGp200Slots(connection, slots, { log, isCancelled, timeoutMs }) {
  const device = new GP200({ input: connection.input, output: readOnly(connection.output), log, ...(timeoutMs ? { timeoutMs } : {}) });
  // No connect(): reads work without the handshake, which would also put the
  // pedal in editor mode.
  try {
    return await readSlots(device, slots, { skeleton: skeletonBytes(), log, isCancelled });
  } finally {
    device.close();
  }
}

/**
 * Convert `files` ({name, data}) for the other pedal, numbered from `start`
 * (a GP-50 patch number, or a GP-200 slot 0-255). Returns the converted files,
 * named for their target so restore orders them; the rows of the sheet; and
 * the files that couldn't be converted, with why.
 */
export function convertFiles(files, start, map, { log }) {
  const out = [], rows = [], refused = [];
  files.forEach((f, i) => {
    const kind = fileKind(f.data);
    const target = start + i;
    try {
      if (kind !== "GP-200" && kind !== "GP-50") throw new Error("not a GP-200 or GP-50 patch");
      const toGp50 = kind === "GP-200";
      const r = (toGp50 ? gp200ToGp50 : gp50ToGp200)(f.data, map, { log: (s) => log.info(s) });
      const label = toGp50 ? String(target) : slotToLabel(target);
      const name = toGp50 ? slotFileName(target, r.name) : `${label}_${r.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "patch"}.prst`;
      out.push({ name, data: r.prst });
      rows.push({ pair: i + 1, from: f.name, source: r.source, to: label, name: r.name, notes: r.notes });
      for (const n of r.notes) log.info(`  ${f.name}: ${n}`);
    } catch (err) {
      refused.push({ file: f.name, reason: err.message });
      log.error(`${f.name}: can't be converted: ${err.message}`);
    }
  });
  // DESIGN.md: two different names that come out the same are both kept, and said.
  for (const r of rows) {
    const others = rows.filter((o) => o !== r && o.name === r.name && o.source !== r.source);
    if (others.length) r.notes.push(`Name "${r.name}" is also what ${others.map((o) => `"${o.source}" (${o.to})`).join(", ")} became`);
  }
  return { files: out, rows, refused };
}

const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;

/** The listening sheet (CSV): one row per pair, the notes, and an empty verdict column. */
export function sheet(rows, targetPedal) {
  const head = ["Pair", "Source file", `${targetPedal} patch`, "Name there", "What changed", "Verdict (same / close / off)", "Comment"];
  return [head, ...rows.map((r) => [r.pair, r.from, r.to, r.name, r.notes.join("; ") || "nothing", "", ""])].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
