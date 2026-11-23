// The effect map between the GP-200 and the GP-50 (stage 2, DESIGN.md "Both
// pedals"): which effect each code becomes on the other pedal, and where each
// setting goes. No DOM; used by tools/make-effect-map.js and, in stage 3, the
// converter.
//
// Facts come from Valeton's own files, read where they are installed:
//   GP-200 editor: Resource/GP-200/File/algorithm.xml (effects, controls);
//                  description_en.xml (what each effect is based on)
//   Valeton Suite: data/flutter_assets/assets/data/module50_data.json (GP-50)
// Only facts are kept (codes, names, positions, ranges, defaults), not
// Valeton's text. Judgments (a near match for an effect the other pedal
// lacks, a code the two files describe differently) are in
// gp50/effect-map-choices.json, for the developer to review.
//
// Positions: a control's place among the 15 (GP-200) or 8 (GP-50) stored
// values of its module. GP-200: the Knob's ID (not idx, the display order).
// GP-50: algId. Checked against real patches (DEV_JOURNAL.md, 2026-11-23,
// "GP-50 stage 2").

export const GP200_MODULES = ["PRE", "WAH", "DST", "AMP", "NR", "CAB", "EQ", "MOD", "DLY", "RVB", "VOL"];
export const GP50_MODULES = ["NR", "PRE", "DST", "AMP", "CAB", "EQ", "MOD", "DLY", "RVB", "NAM"];
export const GP200_VALUES = 15;
export const GP50_VALUES = 8;

export const hex = (code) => "0x" + (code >>> 0).toString(16).toUpperCase().padStart(8, "0");

/** NAM/SnapTone and user IRs: kept in backups, not copied (DESIGN.md "Both pedals"). */
export function outOfScope(code) {
  return code >>> 24 === 0x0f || (code >>> 20) === 0x0a1;
}

const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attrs = (s) => Object.fromEntries([...s.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], unescape(m[2])]));
const num = (s) => (s === undefined || s === "" ? undefined : Number(s));

/** The GP-200 editor's algorithm.xml -> Map(code -> effect). A code listed in several catalogs keeps its first entry and all catalog names. */
export function parseGp200Xml(xml) {
  const effects = new Map();
  let catalog = null, cur = null, ctl = null;
  for (const line of xml.split(/\r?\n/)) {
    let m;
    if ((m = line.match(/<Catalog\s+(.*?)>/))) catalog = attrs(m[1]).Name;
    else if ((m = line.match(/<Alg\s+(.*?)>/))) {
      const a = attrs(m[1]);
      const code = Number(a.Code) >>> 0;
      const seen = effects.get(code);
      if (seen) { if (!seen.modules.includes(catalog)) seen.modules.push(catalog); cur = null; continue; }
      cur = { code, name: a.Name, modules: [catalog], controls: [] };
      effects.set(code, cur);
    } else if ((m = line.match(/<(Knob|Slider|Switch|Combox)\s+(.*?)\/?>/))) {
      if (!cur) { ctl = null; continue; }
      const a = attrs(m[2]);
      ctl = { pos: num(a.ID), name: a.Name, def: num(a.default) };
      if (m[1] === "Knob" || m[1] === "Slider") Object.assign(ctl, { min: num(a.Dmin), max: num(a.Dmax), step: num(a.step) });
      else ctl.menu = [];
      cur.controls.push(ctl);
    } else if ((m = line.match(/<Menu\s+(.*?)\/>/)) && ctl?.menu) {
      ctl.menu.push(attrs(m[1]).Name);
    }
  }
  for (const e of effects.values()) for (const c of e.controls) if (c.menu) Object.assign(c, { min: 0, max: c.menu.length - 1, step: 1 });
  return effects;
}

/**
 * The GP-200 editor's description_en.xml -> Map(code -> what it's based on).
 * Only the fact (the product named in "Based on ..."), not Valeton's text;
 * effects whose description doesn't start that way get none.
 */
export function parseGp200Descriptions(xml) {
  const out = new Map();
  for (const m of xml.matchAll(/<Algorithm\s+Name="[^"]*"\s+ID="(\d+)"[^>]*description="([^"]*)"/g)) {
    const b = unescape(m[2]).match(/^Based\s+(?:famous\s+)?on\s+(?:the\s+|a\s+)?(?:famous\s+|legendary\s+|classic\s+)*(.+?)(?:[.,;(]\s|\n|$)/i);
    if (!b) continue;
    const s = b[1].replace(/[*®™]/g, "").replace(/\s+/g, " ").trim();
    out.set(Number(m[1]) >>> 0, s.length > 60 ? s.slice(0, 57).replace(/\s+\S*$/, "") + "..." : s);
  }
  return out;
}

/** Valeton Suite's module50_data.json -> Map(code -> effect). */
export function parseGp50Json(text) {
  const d = JSON.parse(text);
  const effects = new Map();
  for (const m of d.modules) for (const e of m.module) {
    const code = e.fxid >>> 0;
    if (effects.has(code)) throw new Error(`GP-50 data lists ${hex(code)} twice`);
    const module = m.name === "N->S" ? "NAM" : m.name;
    effects.set(code, {
      code, name: e.name, title: e.fxtitle, module, basedOn: (e.origin || "").split("\n")[0].trim(),
      controls: (e.alg || []).map((a) => {
        const c = { pos: Number(a.algId), name: a.name, def: Number(a.defaultValue), min: Number(a.min), max: Number(a.max), step: Number(a.step) };
        if (a.widgetType === 1 || a.widgetType === 2) c.menu = String(a.valueRange).split(/\s*[/,]\s*/);
        if (Number(a.sync) >= 0) c.syncPos = Number(a.sync);
        return c;
      }),
    });
  }
  return effects;
}

// Control names that mean the same on both pedals, after normalizing (lower
// case, letters and digits only).
const ALIASES = { vol: "volume", fback: "feedback", pres: "presence", hvol: "hivol", lvol: "lowvol", thre: "threshold", high: "hipitch", low: "lowpitch" };
const key = (name) => { const k = String(name).toLowerCase().replace(/[^a-z0-9]/g, ""); return ALIASES[k] ?? k; };
// Effect names: also ignore a cab's size ("2x12") and a trailing variant number.
const effectKey = (name) => String(name).toLowerCase().replace(/\b\d+x\d+\b/g, "").replace(/\s+\d+$/, "").replace(/[^a-z0-9+]/g, "");

/**
 * Where each source control goes on the target effect. Matched by name (or a
 * name given in `pairs`), then by position when the name differs but the
 * range is the same. Returns the moves, the source controls with no place
 * (dropped), and the target controls with no source (set to their default).
 */
export function mapControls(from, to, pairs = {}) {
  const used = new Set();
  const moves = [], dropped = [];
  const want = (c) => key(pairs[c.name] ?? c.name);
  for (const c of from.controls) {
    let t = to.controls.find((x) => !used.has(x) && key(x.name) === want(c));
    let byPos = false;
    if (!t) { t = to.controls.find((x) => !used.has(x) && x.pos === c.pos && x.min === c.min && x.max === c.max && !from.controls.some((y) => y !== c && want(y) === key(x.name))); byPos = !!t; }
    if (!t) { dropped.push({ pos: c.pos, name: c.name }); continue; }
    used.add(t);
    const mv = { from: c.pos, to: t.pos, name: c.name };
    if (t.name !== c.name) mv.toName = t.name;
    if (byPos) mv.byPosition = true;
    if (pairs[c.name]) mv.paired = true;
    if (t.min > c.min || t.max < c.max) mv.clamp = [t.min, t.max];
    moves.push(mv);
  }
  const filled = to.controls.filter((x) => !used.has(x)).map((x) => ({ pos: x.pos, name: x.name, def: x.def }));
  return { moves, dropped, filled };
}

function entry(from, to, choice) {
  if (!to) return { match: "none" };
  const { moves, dropped, filled } = mapControls(from, to, choice?.controls);
  const e = { to: hex(to.code), toName: to.name };
  const lossy = dropped.length > 0 || moves.some((m) => m.clamp);
  if (choice) e.match = "close";
  else if (lossy) e.match = "close";
  else e.match = effectKey(from.name) === effectKey(to.name) ? "same" : "rename";
  if (choice?.why) e.why = choice.why;
  e.moves = moves;
  if (dropped.length) e.dropped = dropped;
  if (filled.length) e.filled = filled;
  return e;
}

/** Build the whole map from the parsed files and the developer-reviewed choices. */
export function buildMap({ gp200, gp50, descriptions = new Map(), choices = {} }) {
  const conflicts = choices.conflicts ?? {};
  const side = (src, dst, picks) => {
    const out = {};
    for (const e of [...src.values()].sort((a, b) => a.code - b.code)) {
      const k = hex(e.code);
      if (outOfScope(e.code)) { out[k] = { match: "out of scope" }; continue; }
      const pick = picks?.[k];
      const target = pick ? dst.get(Number(pick.to) >>> 0) : dst.get(e.code);
      if (pick && !target) throw new Error(`Choice for ${k} names ${pick.to}, which isn't on the other pedal`);
      if (pick && (pick.name !== e.name || pick.toName !== target.name)) throw new Error(`Choice for ${k} says ${pick.name} -> ${pick.toName}, but Valeton's files say ${e.name} -> ${target.name}`);
      for (const [f, t] of Object.entries(pick?.controls ?? {})) {
        if (!e.controls.some((c) => c.name === f) || !target.controls.some((c) => c.name === t)) throw new Error(`Choice for ${k} pairs controls ${f} -> ${t}, not both there`);
      }
      const en = entry(e, target, pick);
      if (conflicts[k] && en.match !== "none") Object.assign(en, { match: "conflict", why: conflicts[k] });
      out[k] = en;
    }
    return out;
  };
  const gp200Out = {}, gp50Out = {};
  for (const e of [...gp200.values()].sort((a, b) => a.code - b.code)) gp200Out[hex(e.code)] = { name: e.name, modules: e.modules, ...(descriptions.get(e.code) ? { basedOn: descriptions.get(e.code) } : {}), controls: e.controls };
  for (const e of [...gp50.values()].sort((a, b) => a.code - b.code)) gp50Out[hex(e.code)] = { name: e.name, title: e.title, module: e.module, ...(e.basedOn ? { basedOn: e.basedOn } : {}), controls: e.controls };
  return {
    about: "Made by tools/make-effect-map.js from Valeton's GP-200 editor and Valeton Suite files, and gp50/effect-map-choices.json. Don't edit by hand.",
    modules: { gp200: GP200_MODULES, gp50: GP50_MODULES },
    gp200: gp200Out,
    gp50: gp50Out,
    toGp200: side(gp50, gp200, choices.toGp200),
    toGp50: side(gp200, gp50, choices.toGp50),
  };
}

/** Problems with a map, as sentences; empty when it holds together. */
export function checkMap(map) {
  const problems = [];
  const sides = [["toGp200", map.gp50, map.gp200, GP200_VALUES], ["toGp50", map.gp200, map.gp50, GP50_VALUES]];
  for (const [dir, src, dst, width] of sides) {
    for (const [k, e] of Object.entries(src)) {
      const en = map[dir][k];
      if (!en) { problems.push(`${dir}: ${k} ${e.name} has no entry`); continue; }
      if (!["same", "rename", "close", "conflict", "none", "out of scope"].includes(en.match)) problems.push(`${dir}: ${k} has match "${en.match}"`);
      if (en.match === "none" || en.match === "out of scope") continue;
      const t = dst[en.to];
      if (!t) { problems.push(`${dir}: ${k} goes to ${en.to}, which isn't on the other pedal`); continue; }
      const seenFrom = new Set(), seenTo = new Set();
      for (const mv of en.moves) {
        const sc = e.controls.find((c) => c.pos === mv.from), tc = t.controls.find((c) => c.pos === mv.to);
        if (!sc) problems.push(`${dir}: ${k} moves position ${mv.from}, which ${e.name} doesn't have`);
        if (!tc) problems.push(`${dir}: ${k} moves to position ${mv.to}, which ${t.name} doesn't have`);
        if (mv.to < 0 || mv.to >= width) problems.push(`${dir}: ${k} moves to position ${mv.to}, outside 0-${width - 1}`);
        if (seenFrom.has(mv.from) || seenTo.has(mv.to)) problems.push(`${dir}: ${k} uses position ${mv.from} -> ${mv.to} twice`);
        seenFrom.add(mv.from); seenTo.add(mv.to);
        if (sc && tc && !mv.clamp && (tc.min > sc.min || tc.max < sc.max)) problems.push(`${dir}: ${k} ${sc.name} needs a clamp to ${tc.min}-${tc.max}`);
      }
      const accounted = en.moves.length + (en.dropped?.length ?? 0);
      if (accounted !== e.controls.length) problems.push(`${dir}: ${k} ${e.name} accounts for ${accounted} of ${e.controls.length} controls`);
      if (en.moves.length + (en.filled?.length ?? 0) !== t.controls.length) problems.push(`${dir}: ${k} fills ${en.moves.length + (en.filled?.length ?? 0)} of ${t.name}'s ${t.controls.length} controls`);
      if (en.match === "same" || en.match === "rename") {
        if (en.dropped?.length || en.moves.some((m) => m.clamp)) problems.push(`${dir}: ${k} is "${en.match}" but loses a setting`);
        if (en.to !== k) problems.push(`${dir}: ${k} is "${en.match}" but changes code`);
      }
    }
    for (const k of Object.keys(map[dir])) if (!src[k]) problems.push(`${dir}: entry ${k} isn't an effect of that pedal`);
  }
  return problems;
}

/** Where every code of a patch's modules comes from: [{module, code}] for either pedal's .prst. */
export function patchEffects(prst) {
  const u32 = (i) => (prst[i] | (prst[i + 1] << 8) | (prst[i + 2] << 16) | (prst[i + 3] << 24)) >>> 0;
  const u16 = (i) => prst[i] | (prst[i + 1] << 8);
  const f32 = (i) => new DataView(prst.buffer, prst.byteOffset + i, 4).getFloat32(0, true);
  if (prst.length === 1224 && String.fromCharCode(...prst.slice(0, 4)) === "TSRP") {
    return GP200_MODULES.map((module, m) => { const o = 0xa0 + 72 * m; return { module, code: u32(o + 8), values: Array.from({ length: GP200_VALUES }, (_, k) => f32(o + 12 + 4 * k)) }; });
  }
  if (prst.length === 552 && String.fromCharCode(...prst.slice(0, 5)) === "GP-50") {
    let codes = -1, vals = -1;
    const walk = (s, e) => { for (let i = s; i + 4 <= e; ) { const t = u16(i), l = u16(i + 2); if (t === 2) walk(i + 4, i + 4 + l); if (t === 0x3003 && l === 40) codes = i + 4; if (t === 0x3004 && l === 320) vals = i + 4; i += 4 + l; } };
    walk(0x29, prst.length);
    if (codes < 0 || vals < 0) throw new Error("GP-50 patch without its effect records");
    return GP50_MODULES.map((module, m) => ({ module, code: u32(codes + 4 * m), values: Array.from({ length: GP50_VALUES }, (_, k) => f32(vals + 32 * m + 4 * k)) }));
  }
  throw new Error(`Not a GP-200 or GP-50 patch (${prst.length} bytes)`);
}

/** The review page (gp50/EFFECT_MAP.md): what needs the developer's eyes first, then the rest. */
export function renderReview(map) {
  const L = [];
  const short = (t) => (t.length > 60 ? t.slice(0, 57).replace(/\s+\S*$/, "") + "..." : t).replace(/\|/g, "/");
  const fx = (side, k) => map[side][k];
  const ctl = (c) => c.name;
  const label = (side, k) => `${fx(side, k).name} (${k})`;
  const changes = (en) => {
    const out = [];
    const moved = en.moves.filter((m) => m.from !== m.to);
    if (moved.length) out.push("moved: " + moved.map((m) => `${m.name} ${m.from}->${m.to}`).join(", "));
    // Only pairings worth a look: by position, or given in the choices. Plain aliases (VOL = Volume) aren't listed.
    const renamed = en.moves.filter((m) => m.toName && (m.paired || m.byPosition));
    if (renamed.length) out.push("paired: " + renamed.map((m) => `${m.name} = ${m.toName}${m.byPosition ? " (by position)" : ""}`).join(", "));
    const clamped = en.moves.filter((m) => m.clamp);
    if (clamped.length) out.push("limited: " + clamped.map((m) => `${m.name} to ${m.clamp[0]}-${m.clamp[1]}`).join(", "));
    if (en.dropped?.length) out.push("dropped: " + en.dropped.map(ctl).join(", "));
    if (en.filled?.length) out.push("set to default: " + en.filled.map((c) => `${c.name} ${c.def}`).join(", "));
    return out.join("; ") || "nothing";
  };
  const dirs = [["toGp200", "gp50", "gp200", "GP-50 to GP-200"], ["toGp50", "gp200", "gp50", "GP-200 to GP-50"]];
  const count = (dir, m) => Object.values(map[dir]).filter((e) => e.match === m).length;
  L.push("# Effect map: review", "", "Made by `tools/make-effect-map.js` from Valeton's own files (the GP-200 editor's",
    "`algorithm.xml`, Valeton Suite's `module50_data.json`) and `gp50/effect-map-choices.json`.",
    "Don't edit by hand: change the choices file and run the tool.", "",
    "| | same | rename | close | conflict | none | out of scope |", "|---|---|---|---|---|---|---|");
  for (const [dir, , , title] of dirs) L.push(`| ${title} | ${["same", "rename", "close", "conflict", "none", "out of scope"].map((m) => count(dir, m)).join(" | ")} |`);
  L.push("", "- **same / rename**: the same effect, every setting carried over (some to another position).",
    "- **close**: a setting is lost or limited, or a near match picked by hand (with the reason).",
    "- **conflict**: same code, but Valeton's two files describe different effects.",
    "- **none**: no match; a patch using it can't be copied as it is.",
    "- **out of scope**: NAM/SnapTone and user IRs (DESIGN.md \"Both pedals\").", "");
  L.push("## 1. Conflicts (listen before copying)", "");
  for (const [k, e] of Object.entries(map.toGp50)) if (e.match === "conflict") L.push(`- **${k}**: ${e.why}`);
  for (const [dir, src, , title] of dirs) {
    L.push("", `## ${dir === "toGp200" ? 2 : 4}. ${title}: close`, "", "| From | To | Why | Settings |", "|---|---|---|---|");
    const rows = new Map(); // same code and the same changes: one row
    for (const [k, e] of Object.entries(map[dir])) {
      if (e.match !== "close") continue;
      const c = changes(e);
      const g = e.to === k ? `same|${c}` : k;
      if (!rows.has(g)) rows.set(g, { from: [], to: [], why: e.why ?? "same code", c });
      rows.get(g).from.push(e.to === k ? fx(src, k).name : label(src, k));
      rows.get(g).to.push(e.to === k ? e.toName : `${e.toName} (${e.to})`);
    }
    for (const r of rows.values()) L.push(`| ${r.from.join(", ")} | ${r.to.join(", ")} | ${r.why} | ${r.c} |`);
    L.push("", `## ${dir === "toGp200" ? 3 : 5}. ${title}: no match`, "");
    const none = Object.entries(map[dir]).filter(([, e]) => e.match === "none");
    if (!none.length) L.push("None.");
    const byMod = {};
    for (const [k] of none) { const f = fx(src, k); const mod = f.module ?? f.modules[0]; (byMod[mod] ||= []).push(`${f.name}${f.basedOn ? ` (${short(f.basedOn)})` : ""}`); }
    for (const [mod, l] of Object.entries(byMod)) L.push(`- **${mod}** (${l.length}): ${l.join("; ")}`);
  }
  L.push("", "## 6. Same effect, settings moved or renamed (for information)", "", "| Direction | Effect | Settings |", "|---|---|---|");
  for (const [dir, src, , title] of dirs) for (const [k, e] of Object.entries(map[dir])) {
    if (e.match !== "same" && e.match !== "rename") continue;
    const note = changes(e);
    if (note !== "nothing" || e.match === "rename") L.push(`| ${title} | ${label(src, k)}${e.match === "rename" ? ` = ${e.toName}` : ""} | ${note} |`);
  }
  return L.join("\n") + "\n";
}
