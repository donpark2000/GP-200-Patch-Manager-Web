#!/usr/bin/env node
// Round trips through the other pedal's format, with no pedal (journal
// 2026-11-25, "Round trips with no pedal"): every patch of a backup is
// converted to the other pedal and back, and compared setting by setting
// (gp50/roundtrip.js). Reads files only; never opens a MIDI port.
//
//   node tools/round-trip.js <backup zip> --out <folder> [--pairs 51-A] [--max-pairs 20]
//
// Writes into --out: roundtrip_<pedal>_<time>.md (the report), .csv (every
// difference, sorted), .log (each patch's notes, both legs and the second
// trip). With --pairs (GP-200 backups only): gp200_ab_pairs_<time>.zip, for
// the web app's Restore from that patch (A unchanged, B through the GP-50
// format), and listening_ab_<time>.csv (gp50/ab-pairs.js).
// Exit code 0 when no difference is unexplained and no patch is refused;
// 1 when one is; 2 for a wrong command.

import { readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { labelToSlot } from "../src/core/slots.js";
import { parseLeadingSlotLabel } from "../src/core/upload.js";
import { readZip } from "../src/core/unzip.js";
import { createZip } from "../src/core/zip.js";
import { pairFiles, pairSheet, pickPairs } from "../gp50/ab-pairs.js";
import { fileKind } from "../gp50/restore.js";
import { mapAsymmetries, roundTripAll, SIDES, tally } from "../gp50/roundtrip.js";

export const MAP_FILE = new URL("../gp50/effect-map.json", import.meta.url);
const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csv = (rows) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const VERDICTS = ["unexplained", "by rule", "explained"];

/** The report, in Markdown. */
export function report({ source, side, results, t, asym, pairs }) {
  const other = SIDES[side].other;
  const L = [`# Round trip ${side} -> ${other} -> ${side}`, "", `Source: \`${source}\`, ${results.length} patches, ${new Date().toISOString().slice(0, 10)}. No pedal used.`, ""];
  const un = results.flatMap((r) => (r.diffs ?? []).filter((d) => d.verdict === "unexplained").map((d) => ({ r, d })));
  L.push("## Verdict", "", `- **Unexplained differences: ${un.length}** (a note in neither report accounts for them)`, `- Refused by the converter: ${t.refused}`,
    `- Came back with no difference at all: ${t.unchanged}`, `- Settle on a second round trip: ${t.settles} of ${results.length - t.refused}`, "");
  if (un.length) {
    L.push("## Unexplained", "");
    for (const { r, d } of un) L.push(`- ${r.file}: ${d.area} ${d.module ?? ""} ${d.control ?? ""} ${d.n ?? ""}: ${d.from} -> ${d.to}. ${d.why}`);
    L.push("");
  }
  for (const r of results.filter((x) => x.refused)) L.push(`- Refused: ${r.file}: ${r.refused}`);
  const unsettled = results.filter((r) => !r.refused && !r.settles);
  if (unsettled.length) {
    L.push("## Don't settle (a second round trip changes them again)", "");
    for (const r of unsettled) L.push(`- ${r.file}: ${r.again.map((d) => `${d.area} ${d.module ?? ""} ${d.from} -> ${d.to}`).join("; ")}`);
    L.push("");
  }
  L.push("## Differences by kind", "", "| Verdict | Area | Count |", "|---|---|---|");
  for (const v of VERDICTS) for (const [k, n] of Object.entries(t.byArea).filter(([k]) => k.startsWith(`${v}:`)).sort((a, b) => b[1] - a[1])) L.push(`| ${v} | ${k.slice(v.length + 2)} | ${n} |`);
  L.push("");
  const rules = {};
  for (const r of results) for (const d of r.diffs ?? []) if (d.verdict === "by rule") rules[d.why] = (rules[d.why] ?? 0) + 1;
  if (Object.keys(rules).length) {
    L.push("## By rule (not carried, not reported)", "");
    for (const [why, n] of Object.entries(rules).sort((a, b) => b[1] - a[1])) L.push(`- ${n}: ${why}`);
    L.push("");
  }
  const back = {}, left = {};
  for (const r of results) for (const d of r.diffs ?? []) {
    if (d.area !== "effect") continue;
    const k = `${d.module}: ${d.from} -> ${d.to}`;
    const o = /left out/.test(d.why) ? left : back;
    (o[k] ??= { n: 0, on: 0 }).n++;
    if (d.on) o[k].on++;
  }
  const table = (o) => Object.entries(o).sort((a, b) => b[1].n - a[1].n).map(([k, x]) => `| ${k} | ${x.n} | ${x.on} |`);
  if (Object.keys(back).length) L.push("## Came back as another effect", "", `A near match on the way, back as that ${other} effect's own match.`, "", "| Module: from -> back | Patches | On in them |", "|---|---|---|", ...table(back), "");
  if (Object.keys(left).length) L.push("## Left out on the way (back as the blank patch's)", "", "| Module: from -> back | Patches | On in them |", "|---|---|---|", ...table(left), "");
  const mine = asym.filter((a) => a.side === side);
  L.push(`## The map alone: ${side} effects that come back as another`, "", mine.length ? mine.map((a) => `- ${a.from} -> ${a.via} -> ${a.back}`).join("\n") : "None.", "");
  if (pairs) {
    L.push("## A/B pairs for listening on the GP-200", "",
      `\`${pairs.zip}\`: ${pairs.rows.length} pairs, ${pairs.rows.length * 2} patches, ${pairs.rows[0].a} to ${pairs.rows.at(-1).b} (from ${pairs.candidates} usable patches; ${pairs.kinds.length} kinds of change).`,
      pairs.uncovered.length ? `Not covered: ${pairs.uncovered.join(", ")}.` : "Every kind covered.", "", "| Pair | A / B | Source | What B changes |", "|---|---|---|---|",
      ...pairs.rows.map((r) => `| ${r.pair} | ${r.a} / ${r.b} | ${r.source} | ${r.kinds}${r.back ? ` (way back also guessed: ${r.back})` : ""} |`), "");
  }
  return L.join("\n");
}

/** Every difference, one row each. */
export function diffRows(results) {
  const rows = [["Patch", "Verdict", "Area", "Module", "Control / CTRL / EXP", "Was on", "Went", "Came back", "Why"]];
  for (const r of results) {
    if (r.refused) { rows.push([r.file, "refused", "", "", "", "", "", "", r.refused]); continue; }
    const sorted = [...r.diffs].sort((a, b) => VERDICTS.indexOf(a.verdict) - VERDICTS.indexOf(b.verdict));
    for (const d of sorted) rows.push([r.file, d.verdict, d.area, d.module, d.control ?? d.n, d.on === undefined ? "" : d.on ? "on" : "off", d.from, d.to, d.why]);
  }
  return csv(rows);
}

const USAGE = "usage: node tools/round-trip.js <backup zip> --out <existing folder> [--pairs 51-A] [--max-pairs 20]";

export async function main(argv, { print = console.log } = {}) {
  let v, positionals;
  try {
    ({ values: v, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { out: { type: "string" }, pairs: { type: "string" }, "max-pairs": { type: "string" } } }));
  } catch (err) {
    print(`${err.message}\n${USAGE}`);
    return 2;
  }
  const [zipFile] = positionals;
  if (!zipFile || positionals.length > 1 || !v.out || !statSync(v.out, { throwIfNoEntry: false })?.isDirectory()) { print(USAGE); return 2; }
  const maxPairs = v["max-pairs"] === undefined ? 20 : Number(v["max-pairs"]);
  if (!Number.isInteger(maxPairs) || maxPairs < 2) { print(`--max-pairs ${v["max-pairs"]}: a whole number, 2 or more`); return 2; }
  const files = [...(await readZip(new Uint8Array(readFileSync(zipFile))))].filter(([n]) => n.toLowerCase().endsWith(".prst")).map(([name, data]) => ({ name, data }));
  const kinds = new Set(files.map((f) => fileKind(f.data)));
  const side = [...kinds][0];
  if (kinds.size !== 1 || !SIDES[side]) { print(`${zipFile}: needs .prst files of one pedal (found: ${[...kinds].join(", ") || "none"})`); return 2; }
  let start = null;
  if (v.pairs !== undefined) {
    if (side !== "GP-200") { print("--pairs is for GP-200 backups (the pairs are played on the GP-200)"); return 2; }
    try { start = labelToSlot(v.pairs); } catch (err) { print(`--pairs ${v.pairs}: ${err.message}`); return 2; }
  }
  const map = JSON.parse(readFileSync(MAP_FILE, "utf8"));
  const results = roundTripAll(files, side, map);
  const t = tally(results);
  const time = stamp();
  const tag = `${side === "GP-50" ? "gp50" : "gp200"}_${time}`;
  const log = [`round-trip: ${argv.join(" ")}`, `Node ${process.version}, ${os.type()} ${os.release()}, ${new Date().toISOString()}`];
  for (const r of results) {
    log.push(`${r.file} "${r.source}"`);
    if (r.refused) { log.push(`  REFUSED: ${r.refused}`); continue; }
    for (const n of r.there.notes) log.push(`  there: ${n}`);
    for (const n of r.back.notes) log.push(`  back:  ${n}`);
    for (const d of r.diffs) log.push(`  diff [${d.verdict}] ${d.area} ${d.module ?? ""} ${d.control ?? d.n ?? ""}: ${d.from} -> ${d.to}`);
    for (const d of r.again) log.push(`  second trip: ${d.area} ${d.module ?? ""} ${d.from} -> ${d.to}`);
  }
  let pairs = null;
  if (start !== null) {
    const entries = files.map((f) => ({ ...f, slot: parseLeadingSlotLabel(f.name) }));
    if (entries.some((e) => e.slot === null)) { print("--pairs: every file name must start with its patch label (34A_...)"); return 2; }
    const picked = pickPairs(entries, map, { maxPairs });
    if (!picked.pairs.length) { print("--pairs: no patch to pair"); return 2; }
    if (start + picked.pairs.length * 2 > 256) { print(`--pairs ${v.pairs}: ${picked.pairs.length * 2} patches don't fit before 64-D`); return 2; }
    const { files: out, rows } = pairFiles(picked.pairs, start);
    pairs = { ...picked, rows, zip: `gp200_ab_pairs_${time}.zip` };
    writeFileSync(path.join(v.out, pairs.zip), createZip(out));
    writeFileSync(path.join(v.out, `listening_ab_${time}.csv`), pairSheet(rows));
    for (const p of picked.pairs) log.push(`pair: ${p.name}: ${p.control ? "check pair" : p.change.kinds.join("; ")}`);
  }
  writeFileSync(path.join(v.out, `roundtrip_${tag}.md`), report({ source: path.basename(zipFile), side, results, t, asym: mapAsymmetries(map), pairs }));
  writeFileSync(path.join(v.out, `roundtrip_${tag}.csv`), diffRows(results));
  writeFileSync(path.join(v.out, `roundtrip_${tag}.log`), log.join("\n") + "\n");
  const unexplained = t.byVerdict.unexplained ?? 0;
  const ok = unexplained === 0 && t.refused === 0;
  print(`Round trip ${side}: ${results.length} patches; ${unexplained} unexplained, ${t.byVerdict["by rule"] ?? 0} by rule, ${t.byVerdict.explained ?? 0} explained; ${t.refused} refused; ${t.settles} settle on a second trip${pairs ? `; ${pairs.rows.length} A/B pairs in ${pairs.zip}` : ""}. ${ok ? "PASSED" : "FAILED"}`);
  print(`Report: roundtrip_${tag}.md`);
  return ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main(process.argv.slice(2));
