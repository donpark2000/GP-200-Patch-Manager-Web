// Round trips through the other pedal's format, with no pedal (journal
// 2026-11-25, "Round trips with no pedal"). A patch is converted to the other
// pedal and back, and what came back is compared with what went, setting by
// setting: the converter's fields, not raw bytes (the bytes it doesn't use
// come from the other pedal's blank patch, so they always differ). Each
// difference is sorted:
//   explained    a note in one of the two reports accounts for it
//   by rule      a written rule says it isn't carried, and it isn't reported
//   unexplained  neither: a bug, or a change the user isn't told about
// What came back is then sent round again; a second trip must change nothing
// ("settles"), or the map has chains (X -> Y -> Z). No DOM.
//
// A round trip can't show a mistake made the same way in both directions (a
// setting moved to the wrong place both ways comes back right), nor the GP-50
// fields taken but not confirmed (Q20). It checks consistency, not sound.

import { gp200ToGp50, gp50ToGp200, readGp200, readGp50 } from "./convert.js";
import { GP200_MODULES, GP50_MODULES, hex } from "./effect-map.js";

export const SIDES = {
  "GP-50": { read: readGp50, there: gp50ToGp200, back: gp200ToGp50, fx: "gp50", toOther: "toGp200", modules: GP50_MODULES, other: "GP-200" },
  "GP-200": { read: readGp200, there: gp200ToGp50, back: gp50ToGp200, fx: "gp200", toOther: "toGp50", modules: GP200_MODULES, other: "GP-50" },
};

const GP200_MODULE_BITS = (1 << GP200_MODULES.length) - 1; // CTRL bits 0-10; 11-15 unknown

/** The effect a module holds, by name ("?" if the map doesn't know the code). */
const fxName = (map, side, code) => map[SIDES[side].fx][hex(code)]?.name ?? `? ${hex(code)}`;

/**
 * What differs between two patches of one pedal, in the converter's terms.
 * Each: { area, module?, control?, n?, from, to, on? } (on: the module was on
 * in the first, so the difference is heard as the patch is called up).
 */
export function compare(a, b, side, map) {
  const out = [];
  const add = (d) => out.push(d);
  if (a.name.trim() !== b.name.trim()) add({ area: "name", from: a.name.trim(), to: b.name.trim() });
  if (a.tempo !== b.tempo) add({ area: "tempo", from: a.tempo, to: b.tempo });
  if (a.volume !== b.volume) add({ area: "volume", from: a.volume, to: b.volume });
  for (const A of a.modules) {
    const B = b.modules[A.index];
    const base = { module: A.module, on: A.on };
    if (A.code !== B.code) {
      add({ ...base, area: "effect", from: fxName(map, side, A.code), to: fxName(map, side, B.code), onAfter: B.on });
      continue;
    }
    if (A.on !== B.on) add({ ...base, area: "on", from: A.on ? "on" : "off", to: B.on ? "on" : "off" });
    for (const c of map[SIDES[side].fx][hex(A.code)]?.controls ?? []) {
      const x = A.values[c.pos], y = B.values[c.pos];
      if (x !== y && !(Number.isNaN(x) && Number.isNaN(y))) add({ ...base, area: "setting", control: c.name, pos: c.pos, from: x, to: y });
    }
  }
  const names = (order) => order.map((i) => SIDES[side].modules[i]);
  if (a.order.join() !== b.order.join()) add({ area: "order", from: names(a.order).join(" "), to: names(b.order).join(" ") });
  const lowBits = side === "GP-200" ? GP200_MODULE_BITS : 0xffffffff;
  a.ctrlMasks.forEach((m, n) => {
    const o = b.ctrlMasks[n];
    const mods = (mask) => SIDES[side].modules.filter((_, i) => (mask >>> i) & 1).join("+") || "none";
    if (((m ^ o) & lowBits) >>> 0) add({ area: "ctrl", n: n + 1, from: mods(m), to: mods(o) });
    if (side === "GP-200" && (m >>> 11) !== (o >>> 11)) add({ area: "ctrl-high", n: n + 1, from: `0x${(m >>> 11).toString(16)}`, to: `0x${(o >>> 11).toString(16)}` });
  });
  if (side === "GP-200") {
    a.exp.forEach((e, i) => {
      const f = b.exp[i];
      const show = (r) => (r.module === 0xff ? "none" : `${GP200_MODULES[r.module] ?? r.module}/${r.control} ${round(r.a)}-${round(r.b)}`);
      if (e.module !== f.module || e.control !== f.control || e.a !== f.a || e.b !== f.b) add({ area: "exp", n: e.id, from: show(e), to: show(f) });
    });
  } else {
    if (a.exp.some((x, i) => x.join() !== b.exp[i].join())) add({ area: "exp", from: a.exp.map((x) => x.join(".")).join(" "), to: b.exp.map((x) => x.join(".")).join(" ") });
    if (a.ctrl.slice(8).join() !== b.ctrl.slice(8).join()) add({ area: "ctrl-bytes", from: a.ctrl.slice(8).join(" "), to: b.ctrl.slice(8).join(" ") });
  }
  return out;
}
const round = (v) => Math.round(v * 100) / 100;

const word = (text, name) => new RegExp(`(^|[^A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z]|$)`, "i").test(text);

/**
 * Sorts one difference: { verdict: "explained" | "by rule" | "unexplained", why }.
 * ctx: { side, notes1, notes2 (the reports of the two legs), placed1 (each
 * module -> the other pedal's module its effect went to), map, a (first) }.
 */
export function explain(d, { side, notes1, notes2, placed1, map, a }) {
  const all = [...notes1, ...notes2];
  const ok = (why) => ({ verdict: "explained", why });
  const rule = (why) => ({ verdict: "by rule", why });
  const no = (why) => ({ verdict: "unexplained", why });
  const moduleNotes = (m) => [
    ...notes1.filter((t) => t.startsWith(`${m}:`)),
    ...(placed1[m] ? notes2.filter((t) => t.startsWith(`${placed1[m]}:`)) : []),
  ];
  if (["effect", "on", "setting"].includes(d.area)) {
    if (side === "GP-200" && d.module === "VOL") return rule("the GP-200's volume module has nowhere to go on the GP-50 and isn't reported (DESIGN.md, converter rules)");
    if (side === "GP-50" && d.module === "NAM" && !moduleNotes("NAM").length) return rule("NAM/SnapTone isn't copied; an off NAM module isn't reported");
    const mine = moduleNotes(d.module);
    if (d.area === "effect") return mine.length ? ok(mine.join(" | ")) : no(`no note for ${d.module}`);
    // Left out on the way: it comes back as the blank patch's, every setting with it.
    const leftOut = mine.filter((t) => /left out/.test(t));
    if (leftOut.length) return ok(leftOut.join(" | "));
    if (d.area === "on") {
      const hit = mine.filter((t) => /switched off|stand-in|left out/.test(t));
      return hit.length ? ok(hit.join(" | ")) : no(`no note switches ${d.module} ${d.to}`);
    }
    // A setting: a note for the module naming the control, by its name on
    // either pedal (the way back names the other pedal's control).
    const entry = map[SIDES[side].toOther][hex(a.modules.find((m) => m.module === d.module).code)];
    const other = entry?.moves?.find((mv) => mv.from === d.pos)?.toName;
    const names = [d.control, other].filter(Boolean);
    const hit = mine.filter((t) => names.some((n) => word(t, n)));
    if (hit.length) return ok(hit.join(" | "));
    return no(mine.length ? `${d.module} has a note, but none names ${names.join(" / ")}: ${mine.join(" | ")}` : `no note for ${d.module}`);
  }
  if (d.area === "name") {
    const hit = all.filter((t) => t.startsWith("Name shortened"));
    return hit.length ? ok(hit.join(" | ")) : no("no note about the name");
  }
  if (d.area === "volume") {
    const hit = all.filter((t) => t.startsWith("Patch volume limited"));
    return hit.length ? ok(hit.join(" | ")) : no("no note about the patch volume");
  }
  if (d.area === "tempo") return no("tempo is carried; nothing should change it");
  if (d.area === "order") return no("chain order follows the source; it came back different");
  if (d.area === "ctrl") {
    const hit = all.filter((t) => t.startsWith(`CTRL ${d.n}:`));
    return hit.length ? ok(hit.join(" | ")) : no(`no note for CTRL ${d.n}`);
  }
  if (d.area === "ctrl-high") return rule("CTRL bits 11-15 (meaning unknown) aren't carried; only logged (Q14)");
  if (d.area === "exp") {
    const hit = all.filter((t) => t.startsWith("EXP:"));
    if (hit.length) return ok(hit.join(" | "));
    return rule(side === "GP-200" ? "GP-200 EXP isn't carried (the GP-50 has no built-in pedal); only extra assignments are reported" : "GP-50 EXP isn't carried (fields not confirmed)");
  }
  if (d.area === "ctrl-bytes") return rule("the 2 bytes after the GP-50's CTRL masks (meaning unknown) are the empty patch's");
  return no(`unknown area ${d.area}`);
}

/**
 * Chain order: a difference only because modules that were left out or
 * changed effect (each with its own difference) took their default places
 * is put down to those modules, not counted again.
 */
function orderVerdict(d, diffs, side, placed1) {
  const moved = new Set(SIDES[side].modules.filter((m) => !(m in placed1)));
  for (const x of diffs) if (x.area === "effect") moved.add(x.module);
  const strip = (s) => s.split(" ").filter((m) => !moved.has(m)).join(" ");
  if (strip(d.from) === strip(d.to)) return { verdict: "explained", why: `only modules left out on the way or changed moved (${[...moved].join(", ")}): they take their default places` };
  return null;
}

/**
 * One patch there and back, and round again. Returns { source, there, back,
 * diffs (each with verdict and why), again (differences on the second trip),
 * settles } or { source, refused } when a leg throws.
 */
export function roundTrip(prst, side, map) {
  const S = SIDES[side];
  const a = S.read(prst);
  let there, back, there2, back2;
  try {
    there = S.there(prst, map);
    back = S.back(there.prst, map);
  } catch (err) {
    return { source: a.name.trim(), refused: err.message };
  }
  const b = S.read(back.prst);
  const ctx = { side, notes1: there.notes, notes2: back.notes, placed1: there.placed, map, a };
  const raw = compare(a, b, side, map);
  const diffs = raw.map((d) => ({ ...d, ...((d.area === "order" && orderVerdict(d, raw, side, there.placed)) || explain(d, ctx)) }));
  let again;
  try {
    there2 = S.there(back.prst, map);
    back2 = S.back(there2.prst, map);
    again = compare(b, S.read(back2.prst), side, map);
  } catch (err) {
    again = [{ area: "refused", from: "", to: err.message }];
  }
  return { source: a.name.trim(), there, back, diffs, again, settles: again.length === 0 };
}

/** Every patch of a backup: [{ slot label or number, file, ...roundTrip }]. */
export function roundTripAll(files, side, map) {
  return files.map((f) => ({ file: f.name, ...roundTrip(f.data, side, map) }));
}

/** Counts for a report: by verdict, and by area within each verdict. */
export function tally(results) {
  const t = { patches: results.length, refused: 0, unchanged: 0, settles: 0, byVerdict: {}, byArea: {} };
  for (const r of results) {
    if (r.refused) { t.refused++; continue; }
    if (!r.diffs.length) t.unchanged++;
    if (r.settles) t.settles++;
    for (const d of r.diffs) {
      t.byVerdict[d.verdict] = (t.byVerdict[d.verdict] ?? 0) + 1;
      const k = `${d.verdict}: ${d.area}`;
      t.byArea[k] = (t.byArea[k] ?? 0) + 1;
    }
  }
  return t;
}

/**
 * The map on its own: each effect sent to its match on the other pedal and
 * back. Returns [{ side, from, via, back }] for each that lands on another
 * effect (a near match one way that another effect's match takes back).
 */
export function mapAsymmetries(map) {
  const out = [];
  const kept = ["same", "rename", "close"];
  for (const [side, fwd, rev, a, b] of [["GP-50", "toGp200", "toGp50", "gp50", "gp200"], ["GP-200", "toGp50", "toGp200", "gp200", "gp50"]]) {
    for (const [k, e] of Object.entries(map[fwd])) {
      if (!kept.includes(e.match)) continue;
      const back = map[rev][e.to];
      if (back && back.to !== k && kept.includes(back.match)) out.push({ side, from: map[a][k].name, via: map[b][e.to]?.name, back: map[a][back.to]?.name, match: e.match });
    }
  }
  return out;
}
