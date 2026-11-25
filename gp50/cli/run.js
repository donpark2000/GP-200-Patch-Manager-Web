// GP-50 from the command line (Windows): DESIGN.md "Both pedals", stage 1.
// A developer tool, never published. It can WRITE to any GP-50 patch.
//
//   node gp50/cli/run.js <command> --out <session folder> [options]
//     info                                       firmware, selected patch, names
//     backup    [--from 0] [--to 99]             one .prst, or a .zip
//     check     --reference <zip> [--shift n]    read all 100 and compare (read only)
//     restore   <files> --start n (--reference <zip> | --skip-reference-check) --write
//     roundtrip --reference <zip> [--shift 1] [--times 1] --write
//   Stage 3, copying between the pedals (gp50/convert.js):
//     copy      --from 1-B --to 12-B --start n (--reference <zip> | --skip-reference-check) --write
//               reads those GP-200 patches (reads only), converts them, and
//               writes them to the GP-50 from patch n
//     convert   <files or zips> --start <n | 50-B>   no pedal: converts each
//               file for the other pedal, numbered from start
//   Both save the source and converted patches and a listening sheet (CSV).
//   The GP-200 (gp200.js; developer, 2026-11-24: the runner may write it):
//     gp200-backup  [--from 1-A] [--to 64-D]   reads only; a .zip
//     gp200-restore <files or one zip> --start 63-A (--reference <gp200 zip> | --skip-reference-check) --write
//               the web app's restore; only slots that still hold what the
//               reference has are overwritten
//
// The reference check (developer, 2026-11-25: it asks instead of refusing):
// only patches whose contents are in the reference zip are overwritten. With
// no reference, or a patch to be overwritten that isn't in it, nothing is
// written and the exit code is 2: Claude asks the developer. On the
// developer's explicit instruction, --skip-reference-check writes without it
// (restore, copy, gp200-restore; a round trip needs its reference).
// The GP-200 is written only by gp200-restore; every other command opens it
// read-only. Its messages are checked in gp200.js / copy.js and midi_bridge.py.
// Ctrl+C stops after the patch being written. Exit code 0 only if all passed,
// 2 when nothing was written and the developer is to be asked, else 1.

import { closeSync, existsSync, openSync, readFileSync, statSync, writeFileSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Logger } from "../../src/core/log.js";
import { labelToSlot, slotToLabel } from "../../src/core/slots.js";
import { readZip } from "../../src/core/unzip.js";
import { createZip } from "../../src/core/zip.js";
import { parseReference } from "../write-steps.js";
import { Gp50Writer } from "../writer.js";
import { ANY_PATCH, backup, check, NeedsAnswer, restore, roundTrip, shifted, SKIP_FLAG } from "./commands.js";
import { convertFiles, readGp200Slots, sheet } from "./copy.js";
import { ALL_GP200_SLOTS, gp200Backup, gp200Reference, gp200Restore } from "./gp200.js";
import { connect } from "./winmm.js";

const OPTIONS = Object.fromEntries(["out", "from", "to", "reference", "shift", "start", "times"].map((k) => [k, { type: "string" }]));
const WRITES = ["restore", "roundtrip", "copy"];
const SKIPPABLE = ["restore", "copy", "gp200-restore"]; // the reference check can be skipped
const GP200_COMMANDS = ["gp200-backup", "gp200-restore"];
const COMMANDS = ["info", "backup", "check", "convert", ...WRITES, ...GP200_COMMANDS];
export const MAP_FILE = new URL("../effect-map.json", import.meta.url);
const loadMap = () => JSON.parse(readFileSync(MAP_FILE, "utf8"));

function number(text, name, fallback) {
  if (text === undefined) return fallback;
  if (!/^\d+$/.test(text)) throw new Error(`--${name} "${text}" isn't a whole number`);
  return Number(text);
}

export const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/** A log that is on disk line by line; the screen gets everything but the MIDI messages. */
export function fileLogger(file, print) {
  const fd = openSync(file, "a");
  const log = new Logger({
    onLine: (line, level) => {
      writeSync(fd, `${line}\n`);
      if (level !== "DEBUG") print(line);
    },
  });
  log.debugEnabled = true;
  log.close = () => closeSync(fd);
  return log;
}

export const loadReference = async (file) => parseReference(await readZip(readFileSync(file)));

/** Everything that can be wrong with the command is found before the port is opened. */
async function parse(argv) {
  const options = { ...OPTIONS, write: { type: "boolean" }, [SKIP_FLAG.slice(2)]: { type: "boolean" } };
  const { values: v, positionals: [command, ...files] } = parseArgs({ args: argv, allowPositionals: true, options });
  if (!COMMANDS.includes(command)) throw new Error(`Commands: ${COMMANDS.join(", ")}`);
  if (!v.out || !statSync(v.out, { throwIfNoEntry: false })?.isDirectory()) throw new Error("--out must be an existing folder (the test session's)");
  const skipCheck = v[SKIP_FLAG.slice(2)] === true;
  if (skipCheck && !SKIPPABLE.includes(command)) throw new Error(`${SKIP_FLAG} is for ${SKIPPABLE.join(", ")} only`);
  if (skipCheck && v.reference) throw new Error(`Give --reference or ${SKIP_FLAG}, not both`);
  if (["check", "roundtrip"].includes(command) && !v.reference) throw new Error("--reference <zip> is needed");
  if ([...WRITES, "gp200-restore"].includes(command) && !v.write) throw new Error(`"${command}" writes to the pedal; add --write to say so`);
  if (SKIPPABLE.includes(command) && !v.reference && !skipCheck) {
    throw new NeedsAnswer(`Nothing written; ask the developer: there's no --reference to check the patches to be overwritten against. To write anyway, only on the developer's explicit instruction: ${SKIP_FLAG}`);
  }
  if (GP200_COMMANDS.includes(command)) return { ...(await parseGp200(command, v, files)), skipCheck };
  const shift = number(v.shift, "shift", command === "roundtrip" ? 1 : 0);
  if (shift > 99) throw new Error(`--shift ${shift} is more than 99`);
  // convert's start is a GP-50 patch number or a GP-200 label ("50-B"): which, the files say.
  const start = command === "convert" && v.start && !/^\d+$/.test(v.start) ? labelToSlot(v.start) : number(v.start, "start", null);
  if (["restore", "copy", "convert"].includes(command) && start === null) throw new Error(`${command} needs --start`);
  if (["restore", "convert"].includes(command) && !files.length) throw new Error(`${command} needs files`);
  let from = 0, to = 99;
  if (command !== "copy") [from, to] = [number(v.from, "from", 0), number(v.to, "to", 99)];
  else {
    if (!v.from || !v.to) throw new Error("copy needs --from and --to (GP-200 patches, e.g. 1-B and 12-B)");
    [from, to] = [labelToSlot(v.from), labelToSlot(v.to)];
    if (to < from) throw new Error(`--to ${v.to} comes before --from ${v.from}`);
    if (start + (to - from) > 99) throw new Error(`${to - from + 1} patches from ${start} don't fit before GP-50 patch 99`);
  }
  const read = [];
  for (const name of files) {
    const data = new Uint8Array(readFileSync(name));
    if (name.toLowerCase().endsWith(".zip")) for (const [n, d] of await readZip(data)) read.push({ name: n, data: d });
    else read.push({ name: path.basename(name), data });
  }
  if (command === "convert") read.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return {
    command, shift, start, out: v.out, from, to, times: number(v.times, "times", 1), skipCheck,
    reference: v.reference ? await loadReference(v.reference) : null,
    files: command === "convert" ? read : files.map((name) => ({ name: path.basename(name), data: new Uint8Array(readFileSync(name)) })),
  };
}

/** gp200-backup and gp200-restore: slots are GP-200 labels ("63-A"). */
async function parseGp200(command, v, files) {
  const out = { command, out: v.out };
  if (command === "gp200-backup") {
    const [from, to] = [labelToSlot(v.from ?? "1-A"), labelToSlot(v.to ?? "64-D")];
    if (to < from) throw new Error(`--to ${v.to} comes before --from ${v.from}`);
    return { ...out, from, to };
  }
  if (!v.start) throw new Error("gp200-restore needs --start (a GP-200 label, e.g. 63-A)");
  if (!files.length) throw new Error("gp200-restore needs files");
  return {
    ...out,
    start: labelToSlot(v.start),
    reference: v.reference ? gp200Reference(await readZip(new Uint8Array(readFileSync(v.reference)))) : null,
    files: files.map((name) => ({ name: path.basename(name), data: new Uint8Array(readFileSync(name)) })),
  };
}

/** The GP-200 commands: only the GP-200 is opened; patch writes only for gp200-restore. */
async function runGp200(a, { open, log, isCancelled, timing }) {
  const writes = a.command === "gp200-restore";
  const connection = await open(log, { pedal: "gp200", gp200Writes: writes });
  try {
    const opts = { log, isCancelled, timeoutMs: timing.gp200TimeoutMs, ...(timing.gp200Write ? { timing: timing.gp200Write } : {}) };
    if (writes) return (await gp200Restore(connection, a.files, a.start, a.reference, { ...opts, skipCheck: a.skipCheck })).ok;
    const slots = Array.from({ length: a.to - a.from + 1 }, (_, i) => a.from + i);
    const r = await gp200Backup(connection, slots, opts);
    const all = slots.length === ALL_GP200_SLOTS.length;
    const complete = r.entries.length === slots.length && !r.cancelled;
    if (r.entries.length) {
      const what = all ? "all" : `${slotToLabel(a.from).replace("-", "")}_to_${slotToLabel(a.to).replace("-", "")}`;
      const name = `gp200_${complete ? what : "INCOMPLETE"}_${stamp()}.zip`;
      writeFileSync(path.join(a.out, name), createZip(r.entries.map((e) => ({ name: e.fileName, data: e.data }))));
      log.info(`Saved ${name} (${r.entries.length} patches)`);
    }
    return complete;
  } finally {
    await connection.close();
  }
}

/**
 * `tag`, or `tag-2`, `tag-3` ... when a file it would name is already in `dir`:
 * names carry the time to the second, and two runs in one second overwrote
 * the first's sheet (journal 2026-11-24, "CTRL confirmed on the GP-50").
 */
export function freeTag(dir, tag, namesFor) {
  for (let k = 1; ; k++) {
    const t = k === 1 ? tag : `${tag}-${k}`;
    if (!namesFor(t).some((n) => existsSync(path.join(dir, n)))) return t;
  }
}

/** Converted patches, their sources and the listening sheet, saved in the session folder. */
function saveConversion(a, sources, r, log) {
  const kinds = r.files.length && r.files[0].name.includes("_") ? "GP-200" : "GP-50";
  const names = (t) => ({ source: `gp200_source_${t}.zip`, zip: `${kinds === "GP-50" ? "gp50" : "gp200"}_converted_${t}.zip`, csv: `listening_${t}.csv` });
  const tag = freeTag(a.out, `${a.command}_${stamp()}`, (t) => Object.values(names(t)));
  const { zip, csv } = names(tag);
  if (sources) writeFileSync(path.join(a.out, names(tag).source), createZip(sources));
  writeFileSync(path.join(a.out, zip), createZip(r.files));
  writeFileSync(path.join(a.out, csv), sheet(r.rows, kinds));
  log.info(`Saved ${zip} (${r.files.length} patches) and ${csv}${sources ? `, and the GP-200 originals` : ""}`);
}

/** copy, before the GP-50 is opened: read the GP-200 range (reads only) and convert it. */
async function readAndConvert(a, { open, log, isCancelled, timeoutMs }) {
  const slots = Array.from({ length: a.to - a.from + 1 }, (_, i) => a.from + i);
  log.info(`Reading GP-200 ${slotToLabel(a.from)} to ${slotToLabel(a.to)} (reads only)`);
  const gp200 = await open(log, { pedal: "gp200" });
  let read;
  try {
    read = await readGp200Slots(gp200, slots, { log, isCancelled, timeoutMs });
  } finally {
    await gp200.close();
  }
  if (read.skipped.length || read.cancelled || read.entries.length !== slots.length) {
    log.error(`Nothing written: ${read.entries.length} of ${slots.length} GP-200 patches read${read.skipped.length ? ` (couldn't read ${read.skipped.join(", ")})` : ""}`);
    return null;
  }
  const sources = read.entries.map((e) => ({ name: e.fileName, data: e.data }));
  const r = convertFiles(sources, a.start, loadMap(), { log });
  saveConversion(a, sources, r, log);
  if (r.refused.length) {
    log.error(`Nothing written: ${r.refused.length} patch(es) can't be converted`);
    return null;
  }
  return r.files;
}

export async function main(argv, { open = connect, print = console.log, timing = {}, isCancelled = () => false } = {}) {
  let log = null;
  let connection = null;
  let writer = null;
  try {
    const a = await parse(argv);
    log = fileLogger(path.join(a.out, `${GP200_COMMANDS.includes(a.command) ? "" : "gp50_"}${a.command}_${stamp()}.log`), print);
    log.info(`GP-50 runner: ${argv.join(" ")}`);
    log.info(`Node ${process.version}, ${os.type()} ${os.release()}, ${new Date().toISOString()}`);
    if (GP200_COMMANDS.includes(a.command)) {
      const ok = await runGp200(a, { open, log, isCancelled, timing });
      log[ok ? "info" : "error"](`${a.command}: ${ok ? "PASSED" : "FAILED"}`);
      return ok ? 0 : 1;
    }
    if (a.command === "convert") {
      const r = convertFiles(a.files, a.start, loadMap(), { log });
      saveConversion(a, null, r, log);
      const ok = r.refused.length === 0;
      log[ok ? "info" : "error"](`convert: ${ok ? "PASSED" : "FAILED"}: ${r.files.length} converted, ${r.refused.length} refused`);
      return ok ? 0 : 1;
    }
    if (a.command === "copy") {
      a.files = await readAndConvert(a, { open, log, isCancelled, timeoutMs: timing.gp200TimeoutMs });
      if (!a.files) return 1;
    }
    connection = await open(log, { onGone: () => writer?.close() });
    const { gp200TimeoutMs, ...gp50Timing } = timing;
    writer = new Gp50Writer(connection.input, connection.output, log, { range: ANY_PATCH, ...gp50Timing });
    log.info(`Firmware ${(await writer.readSettings()).firmware}, on patch ${await writer.readSlot()}`);
    const ok = await run(a, writer, { log, isCancelled });
    log[ok ? "info" : "error"](`${a.command}: ${ok ? "PASSED" : "FAILED"}`);
    return ok ? 0 : 1;
  } catch (err) {
    const ask = err instanceof NeedsAnswer;
    const text = ask ? `${err.message}
${argv[0] ?? "runner"}: NEEDS AN ANSWER` : err.message;
    if (log) log.error(text);
    else print(text);
    return ask ? 2 : 1;
  } finally {
    writer?.close();
    await connection?.close();
    log?.close();
  }
}

async function run({ command, files, reference, from, to, shift, start, times, out, skipCheck }, writer, opts) {
  const { log } = opts;
  if (command === "info") {
    (await writer.readNames()).forEach((n, i) => log.info(`  ${String(i).padStart(2, "0")} ${n}`));
    return true;
  }
  if (command === "backup") {
    const r = await backup(writer, { log, from, to });
    if (r.files.length) {
      const single = from === to;
      const what = from === 0 && to === 99 ? "all" : `${from}_to_${to}`;
      const name = single ? r.files[0].name : `gp50_${r.complete ? what : "INCOMPLETE"}_${stamp()}.zip`;
      writeFileSync(path.join(out, name), single ? r.files[0].data : createZip(r.files));
      log.info(`Saved ${name}`);
    }
    return r.complete;
  }
  if (command === "check") {
    return (await check(writer, shifted(reference, shift), shift ? `the reference moved by ${shift}` : "the reference", opts)).pass;
  }
  if (command === "restore" || command === "copy") return (await restore(writer, files, start, reference, { ...opts, skipCheck })).ok;
  let ok = true;
  for (let i = 1; ok && i <= times; i++) {
    log.info(`Round trip ${i} of ${times}`);
    ok = await roundTrip(writer, reference, shift, opts);
  }
  return ok && times > 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let stop = false;
  process.on("SIGINT", () => {
    console.log("Stopping after this patch...");
    stop = true;
  });
  process.exitCode = await main(process.argv.slice(2), { isCancelled: () => stop });
}
