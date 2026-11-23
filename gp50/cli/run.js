// GP-50 from the command line (Windows): DESIGN.md "Both pedals", stage 1.
// A developer tool, never published. It can WRITE to any GP-50 patch.
//
//   node gp50/cli/run.js <command> --out <session folder> [options]
//     info                                       firmware, selected patch, names
//     backup    [--from 0] [--to 99]             one .prst, or a .zip
//     check     --reference <zip> [--shift n]    read all 100 and compare (read only)
//     restore   <files> --start n --reference <zip> --write
//     roundtrip --reference <zip> [--shift 1] [--times 1] --write
//
// Only patches whose contents are in the reference zip are overwritten.
// Ctrl+C stops after the patch being written. Exit code 0 only if all passed.

import { closeSync, openSync, readFileSync, statSync, writeFileSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Logger } from "../../src/core/log.js";
import { readZip } from "../../src/core/unzip.js";
import { createZip } from "../../src/core/zip.js";
import { parseReference } from "../write-steps.js";
import { Gp50Writer } from "../writer.js";
import { ANY_PATCH, backup, check, restore, roundTrip, shifted } from "./commands.js";
import { connect } from "./winmm.js";

const OPTIONS = Object.fromEntries(["out", "from", "to", "reference", "shift", "start", "times"].map((k) => [k, { type: "string" }]));
const WRITES = ["restore", "roundtrip"];
const COMMANDS = ["info", "backup", "check", ...WRITES];

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
  const { values: v, positionals: [command, ...files] } = parseArgs({ args: argv, allowPositionals: true, options: { ...OPTIONS, write: { type: "boolean" } } });
  if (!COMMANDS.includes(command)) throw new Error(`Commands: ${COMMANDS.join(", ")}`);
  if (!v.out || !statSync(v.out, { throwIfNoEntry: false })?.isDirectory()) throw new Error("--out must be an existing folder (the test session's)");
  if (["check", ...WRITES].includes(command) && !v.reference) throw new Error("--reference <zip> is needed");
  if (WRITES.includes(command) && !v.write) throw new Error(`"${command}" writes to the pedal; add --write to say so`);
  const shift = number(v.shift, "shift", command === "roundtrip" ? 1 : 0);
  if (shift > 99) throw new Error(`--shift ${shift} is more than 99`);
  const start = number(v.start, "start", null);
  if (command === "restore" && (start === null || !files.length)) throw new Error("restore needs files and --start");
  return {
    command, shift, start, out: v.out,
    from: number(v.from, "from", 0), to: number(v.to, "to", 99), times: number(v.times, "times", 1),
    reference: v.reference ? await loadReference(v.reference) : null,
    files: files.map((name) => ({ name: path.basename(name), data: new Uint8Array(readFileSync(name)) })),
  };
}

export async function main(argv, { open = connect, print = console.log, timing = {}, isCancelled = () => false } = {}) {
  let log = null;
  let connection = null;
  let writer = null;
  try {
    const a = await parse(argv);
    log = fileLogger(path.join(a.out, `gp50_${a.command}_${stamp()}.log`), print);
    log.info(`GP-50 runner: ${argv.join(" ")}`);
    log.info(`Node ${process.version}, ${os.type()} ${os.release()}, ${new Date().toISOString()}`);
    connection = await open(log, { onGone: () => writer?.close() });
    writer = new Gp50Writer(connection.input, connection.output, log, { range: ANY_PATCH, ...timing });
    log.info(`Firmware ${(await writer.readSettings()).firmware}, on patch ${await writer.readSlot()}`);
    const ok = await run(a, writer, { log, isCancelled });
    log[ok ? "info" : "error"](`${a.command}: ${ok ? "PASSED" : "FAILED"}`);
    return ok ? 0 : 1;
  } catch (err) {
    if (log) log.error(err.message);
    else print(err.message);
    return 1;
  } finally {
    writer?.close();
    await connection?.close();
    log?.close();
  }
}

async function run({ command, files, reference, from, to, shift, start, times, out }, writer, opts) {
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
  if (command === "restore") return (await restore(writer, files, start, reference, opts)).ok;
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
