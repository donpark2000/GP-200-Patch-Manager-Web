#!/usr/bin/env node
// The module-by-module sound tests for the GP-200 (gp50/sound-tests.js;
// journal 2026-11-26): a zip per module (split where it doesn't fit from the
// start patch to 64-D), each with its listening sheet, and a read-me. Reads
// the map and the choices only; never opens a MIDI port.
//
//   node tools/sound-tests.js --out <existing folder> [--start 32-A]
//
// Writes into --out: 00_READ ME.txt; NN_<module>[-part].zip and .csv; and
// log\sound-tests_<time>.log. Each zip is then checked as the web app's
// Restore reads it, and each B against the real converter.
// Exit code 0 when every check passes; 1 when one doesn't; 2 for a wrong
// command or a choices file that doesn't fit the map.

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { checkPick, planZips, readme, resolveChoices, sheet, verifyZip } from "../gp50/sound-tests.js";
import { labelToSlot, slotToLabel } from "../src/core/slots.js";
import { createZip } from "../src/core/zip.js";

export const MAP_FILE = new URL("../gp50/effect-map.json", import.meta.url);
export const CHOICES_FILE = new URL("../gp50/sound-test-choices.json", import.meta.url);
const USAGE = "usage: node tools/sound-tests.js --out <existing folder> [--start 32-A]";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

export async function main(argv, { print = console.log, mapFile = MAP_FILE, choicesFile = CHOICES_FILE } = {}) {
  let v;
  try {
    ({ values: v } = parseArgs({ args: argv, options: { out: { type: "string" }, start: { type: "string", default: "32-A" } } }));
  } catch (err) {
    print(`${err.message}\n${USAGE}`);
    return 2;
  }
  if (!v.out || !statSync(v.out, { throwIfNoEntry: false })?.isDirectory()) { print(USAGE); return 2; }
  let start;
  try { start = labelToSlot(v.start); } catch (err) { print(`--start ${v.start}: ${err.message}`); return 2; }
  if (start % 4) { print(`--start ${v.start}: start on an A patch, so each test stays in one bank`); return 2; }
  const map = JSON.parse(readFileSync(mapFile, "utf8"));
  const choices = JSON.parse(readFileSync(choicesFile, "utf8"));
  const log = [`sound-tests: ${argv.join(" ")}`, `Node ${process.version}, ${os.type()} ${os.release()}, ${new Date().toISOString()}`];
  let resolved, zips;
  try {
    resolved = resolveChoices(choices, map);
    zips = planZips(resolved, map, start);
  } catch (err) {
    print(`The choices don't fit the map: ${err.message}`);
    return 2;
  }
  const problems = [];
  if (resolved.missing.length) problems.push(`not in the tests or "notTested": ${resolved.missing.join(", ")}`);
  let banks = 0, files = 0, modules = 0;
  for (const z of zips) {
    const bytes = createZip(z.files);
    writeFileSync(path.join(v.out, `${z.base}.zip`), bytes);
    writeFileSync(path.join(v.out, `${z.base}.csv`), sheet(z, map));
    const r = await verifyZip(bytes, z, start, map);
    problems.push(...r.problems.map((p) => `${z.base}: ${p}`));
    banks += r.checked.banks; files += r.checked.files; modules += r.checked.modules;
    log.push(`${z.base}.zip: ${z.banks.length} banks, ${slotToLabel(start)} to ${slotToLabel(start + 4 * z.banks.length - 1)}; checked ${r.checked.files} files, ${r.checked.banks} banks, ${r.checked.modules} modules; ${r.problems.length} problem(s)`);
    for (const b of z.banks) {
      log.push(`  ${b.bank}: ${b.patches.map((p) => `${p.letter} ${p.empty ? "(empty)" : `${p.name.slice(2)} [${p.module}]`}`).join(" | ")} | chain ${b.chain}${b.pickNote ? ` | ${b.pickNote}` : ""}`);
      const c = checkPick(b, map);
      if (c?.problem) problems.push(`${z.base}: ${c.problem}`);
      if (c?.note) log.push(`  ${c.note}`);
    }
  }
  writeFileSync(path.join(v.out, "00_READ ME.txt"), readme(zips, resolved, choices, start, map));
  for (const p of problems) log.push(`PROBLEM: ${p}`);
  const ok = problems.length === 0 && files > 0;
  const summary = `Sound tests: ${zips.length} zips, ${banks} tests; checked ${files} files, ${modules} modules as Restore reads them from ${slotToLabel(start)}; ${problems.length} problem(s). ${ok ? "PASSED" : "FAILED"}`;
  log.push(summary);
  mkdirSync(path.join(v.out, "log"), { recursive: true });
  writeFileSync(path.join(v.out, "log", `sound-tests_${stamp()}.log`), log.join("\n") + "\n");
  for (const p of problems.slice(0, 20)) print(`  ${p}`);
  print(summary);
  return ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main(process.argv.slice(2));
