#!/usr/bin/env node
// Make the GP-200 <-> GP-50 effect map from Valeton's own installed files
// (gp50/effect-map.js says which), plus gp50/effect-map-choices.json.
//
//   node tools/make-effect-map.js                 write gp50/effect-map.json and gp50/EFFECT_MAP.md
//   node tools/make-effect-map.js --check         exit 1 if those two files are stale
//   node tools/make-effect-map.js --patches <.prst, folder or .zip>...
//                                                 also check the map against real patches of either pedal
// Options: --gp200 <folder with algorithm.xml>, --gp50 <module50_data.json>, --verbose.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMap, checkMap, parseGp200Descriptions, parseGp200Xml, parseGp50Json, patchEffects, renderReview } from "../gp50/effect-map.js";
import { readZip } from "../src/core/unzip.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_GP200 = "C:/Program Files/Valeton/GP-200/Resource/GP-200/File";
export const DEFAULT_GP50 = "C:/Program Files/Valeton Suite/Valeton Suite/data/flutter_assets/assets/data/module50_data.json";
export const OUT_JSON = path.join(ROOT, "gp50", "effect-map.json");
export const OUT_MD = path.join(ROOT, "gp50", "EFFECT_MAP.md");
export const CHOICES = path.join(ROOT, "gp50", "effect-map-choices.json");

/** The map and review page, as the text the files should hold. */
export function makeFiles({ gp200Dir = DEFAULT_GP200, gp50Json = DEFAULT_GP50, choicesPath = CHOICES } = {}) {
  const gp200 = parseGp200Xml(fs.readFileSync(path.join(gp200Dir, "algorithm.xml"), "utf8"));
  const descriptions = parseGp200Descriptions(fs.readFileSync(path.join(gp200Dir, "description_en.xml"), "utf8"));
  const gp50 = parseGp50Json(fs.readFileSync(gp50Json, "utf8"));
  const choices = JSON.parse(fs.readFileSync(choicesPath, "utf8"));
  const map = buildMap({ gp200, gp50, descriptions, choices });
  return { map, json: stringify(map), md: renderReview(map), problems: checkMap(map) };
}

/** One effect per line: smaller, and a change shows as one line in a diff. */
export function stringify(map) {
  const isTable = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => x && typeof x === "object" && !Array.isArray(x));
  const parts = Object.entries(map).map(([k, v]) => isTable(v)
    ? `${JSON.stringify(k)}: {\n${Object.entries(v).map(([kk, vv]) => `  ${JSON.stringify(kk)}: ${JSON.stringify(vv)}`).join(",\n")}\n}`
    : `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{\n${parts.join(",\n")}\n}\n`;
}

async function patchFiles(sources) {
  const out = [];
  for (const src of sources) {
    if (src.toLowerCase().endsWith(".zip")) { for (const [name, data] of await readZip(fs.readFileSync(src))) if (name.toLowerCase().endsWith(".prst")) out.push({ name: `${path.basename(src)}:${name}`, data }); }
    else if (fs.statSync(src).isDirectory()) { for (const f of fs.readdirSync(src).sort()) if (f.toLowerCase().endsWith(".prst")) out.push({ name: f, data: new Uint8Array(fs.readFileSync(path.join(src, f))) }); }
    else out.push({ name: path.basename(src), data: new Uint8Array(fs.readFileSync(src)) });
  }
  return out;
}

/**
 * Every effect a patch uses is in the map, and every value at a control's
 * position is in that control's range. A Time or Rate whose effect has a Sync
 * switch on holds a note length instead, and is counted apart.
 */
export function checkPatches(map, files, log = () => {}) {
  const r = { files: 0, skipped: 0, modules: 0, values: 0, synced: 0, unknown: [], outOfRange: [] };
  for (const f of files) {
    let mods;
    try { mods = patchEffects(f.data); } catch (e) { r.skipped++; log(`skipped ${f.name}: ${e.message}`); continue; }
    const side = mods.length === 11 ? map.gp200 : map.gp50;
    r.files++;
    for (const m of mods) {
      r.modules++;
      const k = "0x" + m.code.toString(16).toUpperCase().padStart(8, "0");
      const e = side[k];
      if (!e) { r.unknown.push(`${f.name} ${m.module} ${k}`); continue; }
      // "Sync", "Time Sync", "Sync A", "Sweep Sync": any of them on.
      const synced = e.controls.some((c) => /sync/i.test(c.name) && c.max === 1 && m.values[c.pos] === 1);
      for (const c of e.controls) {
        const v = m.values[c.pos];
        if (synced && /^(time|rate)/i.test(c.name) && v >= 0 && v < 32 && Number.isInteger(v)) { r.synced++; continue; }
        r.values++;
        if (!(v >= c.min - 1e-4 && v <= c.max + 1e-4)) r.outOfRange.push(`${f.name} ${m.module} ${e.name} ${c.name}=${v} (${c.min}-${c.max})`);
      }
    }
  }
  return r;
}

async function main(argv) {
  const opt = { patches: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") opt.check = true;
    else if (a === "--verbose") opt.verbose = true;
    else if (a === "--gp200") opt.gp200Dir = argv[++i];
    else if (a === "--gp50") opt.gp50Json = argv[++i];
    else if (a === "--patches") { while (argv[i + 1] && !argv[i + 1].startsWith("--")) opt.patches.push(argv[++i]); }
    else { console.error(`Unknown option ${a}`); return 2; }
  }
  const { map, json, md, problems } = makeFiles(opt);
  const counts = (dir) => Object.values(map[dir]).reduce((t, e) => ((t[e.match] = (t[e.match] || 0) + 1), t), {});
  console.log(`GP-200 effects: ${Object.keys(map.gp200).length}; GP-50 effects: ${Object.keys(map.gp50).length}`);
  console.log(`GP-50 to GP-200: ${JSON.stringify(counts("toGp200"))}`);
  console.log(`GP-200 to GP-50: ${JSON.stringify(counts("toGp50"))}`);
  if (problems.length) { console.log(`Map problems: ${problems.length}`); problems.forEach((p) => console.log("  " + p)); }
  let ok = problems.length === 0;
  if (opt.patches.length) {
    const r = checkPatches(map, await patchFiles(opt.patches), opt.verbose ? (s) => console.log("  " + s) : () => {});
    console.log(`Patches: ${r.files} read (${r.skipped} skipped), ${r.modules} modules, ${r.values} values checked, ${r.synced} synced Time/Rate values; unknown codes ${r.unknown.length}, out of range ${r.outOfRange.length}`);
    [...r.unknown, ...r.outOfRange].slice(0, opt.verbose ? Infinity : 20).forEach((s) => console.log("  " + s));
    ok &&= r.unknown.length === 0 && r.outOfRange.length === 0;
  }
  if (opt.check) {
    const stale = [[OUT_JSON, json], [OUT_MD, md]].filter(([p, text]) => !fs.existsSync(p) || fs.readFileSync(p, "utf8") !== text).map(([p]) => path.relative(ROOT, p));
    console.log(stale.length ? `Stale: ${stale.join(", ")}. Run: node tools/make-effect-map.js` : "effect-map.json and EFFECT_MAP.md are up to date");
    ok &&= stale.length === 0;
  } else if (problems.length === 0) {
    fs.writeFileSync(OUT_JSON, json);
    fs.writeFileSync(OUT_MD, md);
    console.log(`Wrote ${path.relative(ROOT, OUT_JSON)} and ${path.relative(ROOT, OUT_MD)}`);
  }
  console.log(ok ? "OK" : "FAILED");
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
