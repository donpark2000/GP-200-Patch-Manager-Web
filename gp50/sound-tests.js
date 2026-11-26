// Module-by-module sound tests on the GP-200 alone (journal 2026-11-26, "A new
// approach: one module, one effect at a time"). For each GP-200 effect whose
// GP-50 copy is another effect, a bank of four patches: A, the GP-200 effect
// at its defaults; B, C, D, GP-50 effects the GP-200 also has (B the map's
// current pick), at the settings a copy would carry from A. Each plays through
// the same neutral chain, everything else off, so the developer can pick the
// closest by ear. No DOM; tools/sound-tests.js writes the files.
//
// The alternatives are Claude's picks by kind, in gp50/sound-test-choices.json.
// What B, C and D carry is what the converter would carry: A's settings go to
// the GP-50 effect by the map's entry (the current pick, its hand pairings
// included) or by control name (the others, DESIGN.md: between two different
// effects controls pair by name only), then back to the same effect on the
// GP-200 by the map's GP-50 -> GP-200 entry. It assumes an effect sounds the
// same on both pedals at the same settings (not proven, as for the A/B pairs).

import { gp200ToGp50, gp50ToGp200, readGp200, writeGp200 } from "./convert.js";
import { GP200_MODULES, GP200_VALUES, GP50_VALUES, hex, mapControls, outOfScope } from "./effect-map.js";
import { skeletonBytes } from "../src/core/skeleton.js";
import { isPrst } from "../src/core/prst.js";
import { slotToLabel, TOTAL_SLOTS } from "../src/core/slots.js";
import { expandSources, orderEntries, planUpload, planWarnings } from "../src/core/upload.js";

export const LETTERS = ["A", "B", "C", "D"];
export const EMPTY_NAME = "It's GP-200";
const NAME_LEN = 16;

/** GP-200 effects whose GP-50 copy is another effect (or none at the same code): what the tests are for. */
export function candidates(map) {
  return Object.entries(map.toGp50)
    .filter(([k, e]) => !outOfScope(Number(k)) && e.to && e.to !== k)
    .map(([k]) => k);
}

/** GP-50 effects the GP-200 also has, at the same code: the only ones a test on the GP-200 can play. */
const playable = (map, code) => !!map.gp50[code] && !!map.gp200[code] && !outOfScope(Number(code));

function byName(list, name, what) {
  const hits = list.filter(([, e]) => e.name === name);
  if (hits.length !== 1) throw new Error(`${what} "${name}": ${hits.length ? `${hits.length} effects have that name` : "no such effect"}`);
  return hits[0][0];
}

/**
 * The choices file resolved against the map: [{ module, about, effects: [{ a,
 * chain, alts: [{ code, isPick }], pickNote }] }], or throws naming what
 * doesn't fit (an unknown name, an effect tested twice, a pick listed again,
 * an alternative the GP-200 lacks, more than three).
 */
export function resolveChoices(choices, map) {
  const cands = candidates(map);
  const candList = cands.map((k) => [k, map.gp200[k]]);
  const shared = Object.keys(map.gp50).filter((k) => playable(map, k)).map((k) => [k, map.gp50[k]]);
  const chains = {};
  for (const [name, c] of Object.entries(choices.chains ?? {})) {
    chains[name] = {};
    for (const [mod, fx] of Object.entries(c)) {
      if (!["AMP", "CAB"].includes(mod)) throw new Error(`chain ${name}: ${mod} (a chain has an AMP and a CAB)`);
      const code = byName(shared, fx, `chain ${name} ${mod}`);
      if (!map.gp200[code].modules.includes(mod)) throw new Error(`chain ${name}: ${fx} isn't a GP-200 ${mod} effect`);
      chains[name][mod] = code;
    }
  }
  const seen = new Set();
  const tests = choices.tests.map((t) => ({
    module: t.module, about: t.about,
    effects: t.effects.map((e) => {
      const a = byName(candList, e.name, `${t.module}: GP-200 effect`);
      if (seen.has(a)) throw new Error(`${e.name} is tested twice`);
      seen.add(a);
      if (!chains[e.chain]) throw new Error(`${e.name}: no chain "${e.chain}"`);
      const entry = map.toGp50[a];
      const alts = [];
      let pickNote = null;
      if (entry.match === "stand-in") pickNote = `the map's stand-in, ${entry.toName}, is a switched-off placeholder, not a sound match`;
      else if (!playable(map, entry.to)) pickNote = `the map's pick, the GP-50's ${entry.toName}, isn't on the GP-200 (it has another effect at that code, or none): hear it on the GP-50`;
      else alts.push({ code: entry.to, isPick: true });
      for (const n of e.alts) {
        const code = byName(shared, n, `${e.name}: alternative`);
        if (alts.some((x) => x.code === code)) throw new Error(`${e.name}: ${n} is listed twice, or is the map's pick (the tool adds that)`);
        alts.push({ code, isPick: false });
      }
      if (alts.length > 3) throw new Error(`${e.name}: ${alts.length} alternatives; a bank holds A and three`);
      if (!alts.length) throw new Error(`${e.name}: nothing to hear it against`);
      return { a, chain: e.chain, alts, pickNote };
    }),
  }));
  for (const name of Object.keys(choices.notTested ?? {})) {
    const k = byName(candList, name, "not tested");
    if (seen.has(k)) throw new Error(`${name} is both tested and not tested`);
    seen.add(k);
  }
  const missing = cands.filter((k) => !seen.has(k)).map((k) => map.gp200[k].name);
  return { chains, tests, missing };
}

const defaults = (fx, width) => {
  const v = new Array(width).fill(0);
  for (const c of fx.controls) v[c.pos] = c.def;
  return v;
};
function carry(values, moves, targetFx, width) {
  const out = defaults(targetFx, width);
  for (const mv of moves) {
    let v = values[mv.from];
    if (mv.clamp) v = Math.min(mv.clamp[1], Math.max(mv.clamp[0], v));
    out[mv.to] = v;
  }
  return out;
}
const withCode = (fx, code) => ({ ...fx, code: Number(code) >>> 0 });

/**
 * A's defaults as the GP-50 effect `code` and back on the GP-200: { values,
 * dropped, defaulted } (dropped: A's settings with no place; defaulted: the
 * effect's own settings A has nothing for, left at their defaults).
 */
export function carried(a, code, isPick, map) {
  const fxA = map.gp200[a];
  const there = isPick ? map.toGp50[a] : mapControls(withCode(fxA, a), withCode(map.gp50[code], code));
  const back = map.toGp200[code];
  if (!back || back.to !== code) throw new Error(`${map.gp50[code].name} (${code}) doesn't come back to the GP-200 as itself`);
  const g50 = carry(defaults(fxA, GP200_VALUES), there.moves, map.gp50[code], GP50_VALUES);
  const values = carry(g50, back.moves, map.gp200[code], GP200_VALUES);
  // A Low Cut / High Cut at its off end cuts nothing: losing it changes nothing
  // heard (developer, 2026-11-25, decision 4), so it isn't listed.
  const cutsNothing = (name) => {
    const c = fxA.controls.find((x) => x.name === name);
    return /^(low|high) cut$/i.test(name) && c && c.def === (/^low/i.test(name) ? c.min : c.max);
  };
  return { values, dropped: (there.dropped ?? []).map((d) => d.name).filter((n) => !cutsNothing(n)), defaulted: (there.filled ?? []).map((f) => `${f.name} ${f.def}`) };
}

/** Where an effect sits in a test patch: the test's module if it can sit there, else the first it can. */
function moduleFor(fx, testModule, aModule) {
  for (const m of [testModule, aModule]) if (fx.modules.includes(m)) return m;
  return fx.modules.find((m) => GP200_MODULES.includes(m) && m !== "VOL");
}

/** A GP-200 test patch: the skeleton, every module but the volume pedal off, the chain's amp and cab on, then the tested effect. */
export function testPatch(name) {
  const p = readGp200(skeletonBytes());
  p.name = name.slice(0, NAME_LEN).trimEnd();
  for (const m of p.modules) if (m.module !== "VOL") m.on = false;
  const set = (module, code, values) => Object.assign(p.modules[GP200_MODULES.indexOf(module)], { on: true, code: Number(code) >>> 0, values });
  return { p, set, done: () => writeGp200(p) };
}

/**
 * One bank: [{ letter, name, prst, empty?, code, module, gp50Name, gp200Name,
 * isPick, dropped, defaulted }] x 4 (an empty patch where there are fewer than
 * three alternatives).
 */
export function buildBank(t, e, chains, map) {
  const fxA = map.gp200[e.a];
  const aModule = moduleFor(fxA, t.module, null);
  const chain = chains[e.chain];
  const make = (name, code, module, values) => {
    const { set, done } = testPatch(name);
    for (const [m, c] of Object.entries(chain)) set(m, c, defaults(map.gp200[c], GP200_VALUES));
    set(module, code, values);
    return done();
  };
  const out = [{ letter: "A", name: `A ${fxA.name}`.slice(0, NAME_LEN).trimEnd(), code: e.a, module: aModule, gp200Name: fxA.name, prst: make(`A ${fxA.name}`, e.a, aModule, defaults(fxA, GP200_VALUES)), dropped: [], defaulted: [] }];
  e.alts.forEach((alt, i) => {
    const letter = LETTERS[i + 1];
    const c = carried(e.a, alt.code, alt.isPick, map);
    const module = moduleFor(map.gp200[alt.code], t.module, aModule);
    const name = `${letter} ${map.gp50[alt.code].name}`.slice(0, NAME_LEN).trimEnd();
    out.push({ letter, name, code: alt.code, module, gp50Name: map.gp50[alt.code].name, gp200Name: map.gp200[alt.code].name, isPick: alt.isPick, prst: make(name, alt.code, module, c.values), dropped: c.dropped, defaulted: c.defaulted, values: c.values });
  });
  while (out.length < 4) out.push({ letter: LETTERS[out.length], name: EMPTY_NAME, empty: true, prst: skeletonBytes() });
  return out;
}

/** Splits n banks into as few zips as fit `perZip` banks each, as even as possible: [sizes]. */
export function splitSizes(n, perZip) {
  if (!(perZip >= 1)) throw new Error("no room for a bank");
  const parts = Math.ceil(n / perZip);
  return Array.from({ length: parts }, (_, i) => Math.floor(n / parts) + (i < n % parts ? 1 : 0));
}

const fileSafe = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "patch";
const two = (n) => String(n).padStart(2, "0");

/**
 * Every zip to make, in listening order: [{ base (file name without
 * extension), module, part, parts, about, banks: [{ bank (label of its A
 * slot), effect, patches, chain, pickNote }], files: [{ name, data }] }].
 * Every zip starts at `start` (an A patch).
 */
export function planZips(resolved, map, start) {
  if (start % 4) throw new Error(`start ${slotToLabel(start)}: a test starts on an A patch, so each bank stays in one bank`);
  const perZip = (TOTAL_SLOTS - start) / 4;
  const zips = [];
  for (const t of resolved.tests) {
    const banks = t.effects.map((e) => ({ effect: e, chain: e.chain, chainCodes: resolved.chains[e.chain], pickNote: e.pickNote, patches: buildBank(t, e, resolved.chains, map) }));
    const sizes = splitSizes(banks.length, perZip);
    let from = 0;
    sizes.forEach((size, i) => {
      const part = banks.slice(from, from + size);
      from += size;
      const files = [];
      part.forEach((b, j) => {
        b.bank = slotToLabel(start + 4 * j).slice(0, -1);
        b.patches.forEach((p, k) => {
          p.slot = start + 4 * j + k;
          files.push({ name: `${slotToLabel(p.slot)}_${fileSafe(p.name)}.prst`, data: p.prst });
        });
      });
      zips.push({ module: t.module, about: t.about, part: i + 1, parts: sizes.length, banks: part.map((b) => ({ ...b, patches: b.patches.map((p) => ({ ...p })) })), files });
    });
  }
  zips.forEach((z, i) => { z.base = `${two(i + 1)}_${z.module}${z.parts > 1 ? `-${z.part}` : ""}`; });
  return zips;
}

const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const altCell = (p) => (p.empty ? "(empty)" : `${p.gp50Name}${p.gp200Name !== p.gp50Name ? ` (GP-200: ${p.gp200Name})` : ""}${p.isPick ? " [map's pick]" : ""}`);
const lost = (p) => [p.dropped.length ? `lost: ${p.dropped.join(", ")}` : "", p.defaulted.length ? `at default: ${p.defaulted.join(", ")}` : ""].filter(Boolean).join("; ");

/** The listening sheet for one zip (CSV, opens in Excel). */
export function sheet(zip, map) {
  const head = ["Bank", "A: GP-200 effect (its defaults)", "B", "C", "D", "Chain", "Notes (what B-D carry from A)", "Closest (B / C / D / none)", "Your tweak (setting: value)", "Comment"];
  const rows = zip.banks.map((b) => {
    const [a, ...alts] = b.patches;
    const notes = [b.pickNote ? `Note: ${b.pickNote}.` : "", ...alts.filter((p) => !p.empty && lost(p)).map((p) => `${p.letter}: ${lost(p)}`)].filter(Boolean).join(" | ");
    const chain = ["AMP", "CAB"].map((m) => `${m} ${a.module === m ? "(tested)" : map.gp50[b.chainCodes[m]].name}`).join(", ");
    return [`${b.bank}`, `${a.gp200Name} (${map.gp200[a.code].modules.join("/")})`, ...alts.map(altCell), chain, notes, "", "", ""];
  });
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
/**
 * Checks one zip as the web app's Restore reads it, started at `start`:
 * ordered by slot label, every file planned to the slot its name gives, no
 * warning, each patch the one built; then each bank's patches differ only in
 * the tested effect (the chain the same, everything else off). Returns {
 * problems, checked } (checked: how many files, banks and modules were looked
 * at, so "checked nothing" can't pass).
 */
export async function verifyZip(bytes, zip, start, map) {
  const problems = [];
  const checked = { files: 0, banks: 0, modules: 0 };
  const { entries, notes } = await expandSources([{ name: `${zip.base}.zip`, data: bytes }]);
  problems.push(...notes);
  const { ordered, orderedBy } = orderEntries(entries);
  if (orderedBy !== "slot label") problems.push(`ordered by ${orderedBy}`);
  const plan = planUpload(ordered, start);
  problems.push(...planWarnings(plan));
  const want = zip.banks.flatMap((b) => b.patches);
  if (plan.items.length !== want.length) problems.push(`${plan.items.length} patches planned, ${want.length} built`);
  plan.items.forEach((it, i) => {
    const p = want[i];
    if (!p) return;
    checked.files++;
    if (it.slot !== p.slot) problems.push(`${it.fileName} goes to ${it.label}, built for ${slotToLabel(p.slot)}`);
    if (!it.fileName.startsWith(`${it.label}_`)) problems.push(`${it.fileName} would land on ${it.label}`);
    if (it.data.length !== p.prst.length || it.data.some((x, k) => x !== p.prst[k])) problems.push(`${it.fileName}: not the patch built`);
    if (!isPrst(it.data)) problems.push(`${it.fileName}: not a valid .prst`);
    if (it.patchName !== p.name) problems.push(`${it.fileName}: named "${it.patchName}", built as "${p.name}"`);
  });
  for (const b of zip.banks) {
    checked.banks++;
    const read = b.patches.map((p) => readGp200(p.prst));
    read.forEach((r, i) => {
      const p = b.patches[i];
      if (p.empty) { if (r.name !== EMPTY_NAME) problems.push(`${b.bank}${p.letter}: an empty patch named "${r.name}"`); return; }
      for (const m of r.modules) {
        checked.modules++;
        const what = `${b.bank}${p.letter} ${m.module}`;
        if (m.module === p.module) {
          if (!m.on || hex(m.code) !== p.code) problems.push(`${what}: should be ${map.gp200[p.code].name}, on`);
        } else if (m.module === "VOL") {
          if (!m.on || m.values[0] !== 100) problems.push(`${what}: the volume pedal should be on at 100`);
        } else if (b.chainCodes[m.module]) {
          const c = b.chainCodes[m.module];
          if (!m.on || hex(m.code) !== c || m.values.some((v, k) => v !== Math.fround(defaults(map.gp200[c], GP200_VALUES)[k]))) problems.push(`${what}: should be the chain's ${map.gp200[c].name}, on at its defaults`);
        } else if (m.on) problems.push(`${what}: should be off`);
      }
      if (r.ctrlMasks.some((x) => x)) problems.push(`${b.bank}${p.letter}: a CTRL is set`);
    });
    // Only the tested module differs within a bank: the same order, tempo, volume.
    for (const r of read.slice(1)) {
      if (r.order.join() !== read[0].order.join() || r.tempo !== read[0].tempo || r.volume !== read[0].volume) problems.push(`${b.bank}: chain order, tempo or volume differs within the bank`);
    }
  }
  return { problems, checked };
}

/**
 * B (the map's pick) against the real converter: A's patch to the GP-50 and
 * back must hold the same effect at the same settings. Returns a problem, a
 * note (where the converter rightly does otherwise), or null.
 */
export function checkPick(bank, map) {
  const a = bank.patches[0];
  const b = bank.patches.find((p) => p.isPick);
  if (!b) return null;
  const back = readGp200(gp50ToGp200(gp200ToGp50(a.prst, map).prst, map).prst);
  const hit = back.modules.find((m) => hex(m.code) === b.code && m.module !== "VOL");
  if (!hit) {
    if (a.module === "WAH") return { note: `${bank.bank}: the converter leaves ${map.gp200[a.code].name} out (a wah on the expression pedal goes off on the GP-50, then loses the PRE module)` };
    return { problem: `${bank.bank}: the converter doesn't copy ${map.gp200[a.code].name} as ${b.gp50Name}` };
  }
  const mine = readGp200(b.prst).modules.find((m) => m.module === b.module);
  if (hit.values.some((v, k) => v !== mine.values[k])) return { problem: `${bank.bank}: B's settings aren't what the converter carries (${hit.values.join(",")} vs ${mine.values.join(",")})` };
  return null;
}

/** The read-me for the folder: what to load, in what order, and what was left out. */
export function readme(zips, resolved, choices, start, map) {
  const label = (s) => `${slotToLabel(s).slice(0, -1)}-${slotToLabel(s).slice(-1)}`;
  const L = [
    "MODULE SOUND TESTS (GP-200)",
    "",
    "Why: some close matches came out too strong when patches were copied to the",
    "GP-50 (gain, chorus depth). Here each GP-200 effect the GP-50 lacks is heard",
    "against GP-50 effects the GP-200 also has, one effect at a time, to set",
    "general mapping rules.",
    "",
    "How:",
    `1. In the web app, Restore, pick one zip, start at ${label(start)}.`,
    "2. Each bank is one test: A = the GP-200 effect at its defaults;",
    "   B, C, D = GP-50 effects at the settings a copy would carry from A",
    "   (B is the map's current pick; see the sheet). Patch names start with",
    "   the letter. \"It's GP-200\" = nothing there (fewer than three to try).",
    "3. Everything else is off except an amp and cab (the same in a bank;",
    "   the sheet names them). The expression pedal works the volume (and the",
    "   wah) as in the empty patch: keep it toe down.",
    "4. In the zip's sheet (.csv, same name), write the closest, and the",
    "   tweak that made it closer (setting and value). \"none\" if none is.",
    "5. When a module is done, the next zip may overwrite the same patches.",
    "",
    "Zips, in listening order:",
  ];
  for (const z of zips) {
    const last = start + 4 * z.banks.length - 1;
    L.push(`  ${z.base}.zip  ${z.banks.length} tests, ${label(start)} to ${label(last)}${z.parts > 1 ? ` (part ${z.part} of ${z.parts})` : ""}${z.module === "SPECIAL" ? " (optional)" : ""}`);
  }
  const special = choices.tests.find((t) => t.module === "SPECIAL");
  if (special?.about) L.push("", `SPECIAL: ${special.about}`);
  const notes = zips.flatMap((z) => z.banks.filter((b) => b.pickNote && !/stand-in/.test(b.pickNote)).map((b) => `  ${z.base}, bank ${b.bank}, ${map.gp200[b.effect.a].name}: ${b.pickNote}.`));
  if (notes.length) L.push("", "Can't be heard here:", ...notes);
  L.push("", "Not in the tests:", ...Object.entries(choices.notTested ?? {}).map(([n, why]) => `  ${n}: ${why}.`));
  L.push("", "Made by tools/sound-tests.js; the alternatives are in gp50/sound-test-choices.json.");
  return L.join("\r\n") + "\r\n";
}
