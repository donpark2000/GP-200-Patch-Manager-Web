// Copying patches between the GP-200 and the GP-50 (stage 3, DESIGN.md "Both
// pedals", "Converter rules"). No DOM. Each conversion returns the new .prst
// and a report of everything substituted, dropped or limited; a patch that
// can't be converted throws an Error saying why.
//
// Layouts (DEV_JOURNAL.md, 2026-11-23, "Stage 3: patch layouts"), read from
// the 2026-09-30 GP-200 backup and the GP-50's 100 factory patches:
// GP-200 .prst (1224 bytes):
//   0x36 u16 tempo (BPM), 0x38 u16 patch volume, 0x44 name (16)
//   0x94-0x9E chain order: the 11 module numbers in playing order
//   0xA0 + 72*m: module m's block: 14 00 44 00, m, on (0/1), 0F 00, u32 code,
//                15 float32 values
//   0x3B8 + 16*i: 9 EXP records 0C 00 0C 00, id, module (FF none), control, 00,
//                f32, f32 (ids 00-02, 10-12, 20-22)
//   0x448 + 8*i: 3 records 10 00 04 00, n, module (FF none), v, 00: not CTRL
//                (read as CTRL until 2026-11-24); meaning unknown, kept as is
//   0x460 + 12*i: 8 CTRL records 0F 00 08 00, n, 00 00 00, u32: CTRL n+1,
//                bit m = module m switched (bits 0-10); bits 11-15 unknown
// GP-50 .prst (552 bytes): records [u16 tag, u16 length, value] from 0x29, at
// the same offsets in every patch seen:
//   tag 1 { 2001 u8 patch volume, 2002 u32 tempo, 2003-200A (all patches the
//   same: thought to be EXP) }, tag 2 { 3001 u32 on/off, a bit per module;
//   3002 10 bytes chain order; 3003 10 x u32 codes; 3004 10 x 8 float32 },
//   tag 3 { CTRL 1 u32, CTRL 2 u32: a bit per module switched, bit m for
//   module m (NR, PRE, DST, ...); 2 bytes, not known, kept as they are }.
// CTRL on the GP-50 confirmed 2026-11-24 (DEV_JOURNAL.md, "CTRL confirmed"):
// the developer changed patch 99 from PRE/DST (2/4) to NR/EQ (1/32), nothing
// else changed. GP-200 CTRL confirmed 2026-11-24 (journal, "GP-200 CTRL: eight
// masks"): the developer read CTRL 1-8 of 1-C, 3-B and 7-B off the pedal.
// Not yet confirmed on the pedal: which 3001 bit is which module (taken in
// module order, as CTRL's are), the GP-50's tempo and volume fields.

import { buildPrst, BODY_LEN, PRST_LEN as GP50_LEN } from "./protocol.js";
import { GP200_MODULES, GP50_MODULES, GP200_VALUES, GP50_VALUES, hex, outOfScope } from "./effect-map.js";
import { skeletonBytes } from "../src/core/skeleton.js";
import { CHECKSUM_OFF, PRST_LEN as GP200_LEN, prstChecksum } from "../src/core/prst.js";

export const GP50_NAME_LEN = 10;

// ---------------------------------------------------------------- names

const SMALL_WORDS = new Set(["of", "the", "a", "and", "in"]);
const SHORT_WORDS = { lead: "LD", clean: "CL" };

/**
 * A name for the GP-50 (10 characters), Valeton style (developer,
 * 2026-11-23): a name that fits is kept; otherwise, stopping once it fits:
 * keep a 1-2 digit number at the end, Lead -> LD and Clean -> CL, drop small
 * words, run the words together (brackets dropped), then cut.
 */
export function shortenName(name, max = GP50_NAME_LEN) {
  const s = String(name).trim();
  if (s.length <= max) return s;
  // "Wu Shizheng3" keeps its 3; "Friedman BE100" has no patch number.
  const m = s.match(/^(.*[^\d\s])\s?(\d{1,2})$/);
  const base = m ? m[1] : s, tail = m ? m[2] : "";
  const room = max - tail.length;
  const fits = (t) => t.length <= room;
  let words = base.split(/\s+/).map((w) => SHORT_WORDS[w.toLowerCase()] ?? w);
  if (fits(words.join(" "))) return words.join(" ") + tail;
  const kept = words.filter((w, i) => i === 0 || !SMALL_WORDS.has(w.toLowerCase()));
  if (kept.length) words = kept;
  if (fits(words.join(" "))) return words.join(" ") + tail;
  const joined = words.map((w) => w.replace(/[()[\]{}]/g, "")).filter(Boolean)
    .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("");
  return joined.slice(0, room) + tail;
}

// ---------------------------------------------------------------- GP-200 file

const u16 = (d, i) => d[i] | (d[i + 1] << 8);
const u32 = (d, i) => (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24)) >>> 0;
const f32 = (d, i) => new DataView(d.buffer, d.byteOffset + i, 4).getFloat32(0, true);
const put16 = (d, i, v) => { d[i] = v & 0xff; d[i + 1] = (v >> 8) & 0xff; };
const put32 = (d, i, v) => { for (let k = 0; k < 4; k++) d[i + k] = (v >>> (8 * k)) & 0xff; };
const putF32 = (d, i, v) => new DataView(d.buffer, d.byteOffset + i, 4).setFloat32(0, v, true);
const text = (d, a, b) => { let s = ""; for (let i = a; i < b && d[i]; i++) s += String.fromCharCode(d[i]); return s; };
const same = (d, i, bytes) => bytes.every((b, k) => d[i + k] === b);

const GP200_ORDER = 0x94;
const GP200_BLOCK = (m) => 0xa0 + 72 * m;
const GP200_EXP = (i) => 0x3b8 + 16 * i;
const GP200_REC448 = (i) => 0x448 + 8 * i;
const GP200_CTRL = (i) => 0x460 + 12 * i;
export const GP200_CTRLS = 8;
export const GP50_CTRL_MAX = 3; // modules one GP-50 CTRL can switch (developer, 2026-11-24)
// Which GP-200 modules a GP-50 CTRL keeps when more than 3 could go over, most
// important first (developer, 2026-11-24).
export const CTRL_RANK = ["DST", "EQ", "DLY", "MOD", "RVB", "PRE", "CAB", "AMP", "NR", "VOL", "WAH"];
const EXP_IDS = [0x00, 0x01, 0x02, 0x10, 0x11, 0x12, 0x20, 0x21, 0x22];
const NO_MODULE = 0xff;

function isPermutation(list, n) {
  return list.length === n && new Set(list).size === n && list.every((x) => Number.isInteger(x) && x >= 0 && x < n);
}

/** The parts of a GP-200 .prst the converter uses; throws if the layout isn't the one known. */
export function readGp200(prst) {
  if (prst.length !== GP200_LEN || !same(prst, 0, [0x54, 0x53, 0x52, 0x50])) throw new Error(`Not a GP-200 patch (${prst.length} bytes)`);
  const order = [...prst.slice(GP200_ORDER, GP200_ORDER + 11)];
  if (!isPermutation(order, 11)) throw new Error(`GP-200 chain order ${order.join(",")} isn't the 11 modules once each`);
  const modules = GP200_MODULES.map((module, m) => {
    const o = GP200_BLOCK(m);
    if (!same(prst, o, [0x14, 0x00, 0x44, 0x00]) || prst[o + 4] !== m || prst[o + 5] > 1) throw new Error(`GP-200 module ${module}'s block isn't laid out as expected`);
    return { module, index: m, on: prst[o + 5] === 1, code: u32(prst, o + 8), values: Array.from({ length: GP200_VALUES }, (_, k) => f32(prst, o + 12 + 4 * k)) };
  });
  const exp = EXP_IDS.map((id, i) => {
    const o = GP200_EXP(i);
    if (!same(prst, o, [0x0c, 0x00, 0x0c, 0x00, id])) throw new Error(`GP-200 EXP record ${i} isn't laid out as expected`);
    return { id, module: prst[o + 5], control: prst[o + 6], a: f32(prst, o + 8), b: f32(prst, o + 12) };
  });
  for (let n = 0; n < 3; n++) {
    if (!same(prst, GP200_REC448(n), [0x10, 0x00, 0x04, 0x00, n])) throw new Error(`GP-200 record ${n} at 0x448 isn't laid out as expected`);
  }
  const ctrlMasks = Array.from({ length: GP200_CTRLS }, (_, n) => {
    const o = GP200_CTRL(n);
    if (!same(prst, o, [0x0f, 0x00, 0x08, 0x00, n, 0, 0, 0])) throw new Error(`GP-200 CTRL ${n + 1}'s record isn't laid out as expected`);
    return u32(prst, o + 8);
  });
  return { name: text(prst, 0x44, 0x54), tempo: u16(prst, 0x36), volume: u16(prst, 0x38), order, modules, exp, ctrlMasks };
}

// What every GP-200 patch seen has (250 and 256 of 256): EXP 1 on the volume
// module, EXP 2 on the wah's control 3, nothing else; the 0x448 record 2 on 0B.
const GP200_DEFAULT_EXP = { 0x00: [10, 0], 0x10: [1, 3] };

/** A GP-200 .prst from the parts readGp200 returns (the skeleton supplies the rest). */
export function writeGp200(p) {
  const out = skeletonBytes();
  if (out.length !== GP200_LEN) throw new Error("GP-200 skeleton has the wrong length");
  out.fill(0, 0x44, 0x54);
  for (let i = 0; i < Math.min(p.name.length, 16); i++) out[0x44 + i] = p.name.charCodeAt(i) & 0x7f;
  put16(out, 0x36, p.tempo);
  put16(out, 0x38, p.volume);
  out.set(p.order, GP200_ORDER);
  for (const m of p.modules) {
    const o = GP200_BLOCK(m.index);
    out[o + 5] = m.on ? 1 : 0;
    put32(out, o + 8, m.code);
    m.values.forEach((v, k) => putF32(out, o + 12 + 4 * k, v));
  }
  // CTRL 1-8: the whole u32 as given (the 0x448 records stay the skeleton's).
  if (p.ctrlMasks) p.ctrlMasks.forEach((mask, n) => put32(out, GP200_CTRL(n) + 8, mask));
  const c = prstChecksum(out);
  out[CHECKSUM_OFF] = c >> 8;
  out[CHECKSUM_OFF + 1] = c & 0xff;
  return out;
}

// ---------------------------------------------------------------- GP-50 file

// Offsets of each record's value in a GP-50 .prst (all 102 files seen).
const GP50_AT = { 0x2001: 85, 0x2002: 90, 0x2003: 98, 0x2004: 103, 0x2005: 111, 0x2006: 119, 0x2007: 124, 0x2008: 129, 0x2009: 134, 0x200a: 139, 0x3001: 148, 0x3002: 156, 0x3003: 170, 0x3004: 214, 3: 538 };
const GP50_LEN_OF = { 0x2001: 1, 0x2002: 4, 0x2003: 1, 0x2004: 4, 0x2005: 4, 0x2006: 1, 0x2007: 1, 0x2008: 1, 0x2009: 1, 0x200a: 1, 0x3001: 4, 0x3002: 10, 0x3003: 40, 0x3004: 320, 3: 10 };
const EXP_TAGS = [0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a];

function gp50Layout(prst) {
  for (const [tag, at] of Object.entries(GP50_AT)) {
    if (u16(prst, at) !== Number(tag) || u16(prst, at + 2) !== GP50_LEN_OF[tag]) throw new Error(`GP-50 record ${Number(tag).toString(16)} isn't where it is in every patch seen`);
  }
}
const val = (tag) => GP50_AT[tag] + 4;

/** The parts of a GP-50 .prst the converter uses; throws if the layout isn't the one known. */
export function readGp50(prst) {
  if (prst.length !== GP50_LEN || !same(prst, 0, [0x47, 0x50, 0x2d, 0x35, 0x30, 0])) throw new Error(`Not a GP-50 patch (${prst.length} bytes)`);
  gp50Layout(prst);
  const order = [...prst.slice(val(0x3002), val(0x3002) + 10)];
  if (!isPermutation(order, 10)) throw new Error(`GP-50 chain order ${order.join(",")} isn't the 10 modules once each`);
  const mask = u32(prst, val(0x3001));
  const modules = GP50_MODULES.map((module, m) => ({
    module, index: m, on: ((mask >>> m) & 1) === 1, code: u32(prst, val(0x3003) + 4 * m),
    values: Array.from({ length: GP50_VALUES }, (_, k) => f32(prst, val(0x3004) + 32 * m + 4 * k)),
  }));
  const ctrl = [...prst.slice(val(3), val(3) + 10)];
  const ctrlMasks = [u32(prst, val(3)), u32(prst, val(3) + 4)];
  const exp = EXP_TAGS.map((t) => [...prst.slice(val(t), val(t) + GP50_LEN_OF[t])]);
  return { name: text(prst, 0x19, 0x29), volume: prst[val(0x2001)], tempo: u32(prst, val(0x2002)), order, modules, ctrl, ctrlMasks, exp };
}

// The GP-50's empty patch ("GP-50", patches 55-99 as they came), from 0x29
// on: every module off. A converted patch starts from it.
const GP50_EMPTY_BODY_B64 =
  "/wAQAAEABAABAAAAAgAEAEdQNTAAABAAARAEAAoAAAACEAQACAAAAAEAOwABIAEAMgIgBAB4AAAAAyABAAAEIAQAAAAAAAUgBABk" +
  "AAAABiABAAAHIAEAAAggAQBkCSABAAAKIAEAAAIAhgEBMAQAAAAAAAIwCgAAAQIJAwQFBgcIAzAoABsAAAAAAAAAAAAAAwEAAAcB" +
  "AAAKNQAAAQAAAAQAAAALCwAADAAAAA8EMEABAACgQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKBBAABIQgAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAIEIAAIxCAABIQgAAAAAAAAAAAAAAAAAAAAAAAAAAAADwQQAASEIAAEhCAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAEhCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABIQgAAAAAAAAAAAABIQgAA" +
  "AD8AAEhCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKBBAAD6QwAA8EEAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8EEAAAAAAABIQgAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAABIQgAASEIAAEhCAABIQgAASEIAAAAAAAAAAAAAAAADAAoAAAAAAAAAAAAFBQ==";

export function gp50EmptyPrst() {
  const bin = atob(GP50_EMPTY_BODY_B64);
  const body = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (body.length !== BODY_LEN) throw new Error(`GP-50 empty patch body is ${body.length} bytes, expected ${BODY_LEN}`);
  return buildPrst("GP-50", body);
}

/** A GP-50 .prst from the parts readGp50 returns (the empty patch supplies the rest). */
export function writeGp50(p) {
  const out = gp50EmptyPrst();
  gp50Layout(out);
  out[val(0x2001)] = p.volume;
  put32(out, val(0x2002), p.tempo);
  put32(out, val(0x3001), p.modules.reduce((mask, m) => (m.on ? mask | (1 << m.index) : mask), 0) >>> 0);
  out.set(p.order, val(0x3002));
  for (const m of p.modules) {
    put32(out, val(0x3003) + 4 * m.index, m.code);
    m.values.forEach((v, k) => putF32(out, val(0x3004) + 32 * m.index + 4 * k, v));
  }
  if (p.ctrlMasks) p.ctrlMasks.forEach((mask, n) => put32(out, val(3) + 4 * n, mask));
  // Header, CRC and name are rebuilt around the body.
  return buildPrst(p.name, out.slice(0x29));
}

// ---------------------------------------------------------------- effects

const SYNC = /sync/i;
const SYNCED = /^(time|rate)/i;

/**
 * One module's effect on the other pedal: its values, with a note of what
 * changed. A Time or Rate whose effect has a Sync switch on holds a note
 * length, not a time (DEV_JOURNAL.md 2026-11-23, "GP-50 stage 2"), so it is
 * carried as it is when the target is synced too, and set to the target's
 * default when not.
 */
function convertEffect(src, srcFx, entry, target, note, fxName) {
  const values = new Array(target.width).fill(0);
  for (const c of target.effect.controls) values[c.pos] = c.def;
  if (entry.match === "stand-in") {
    note(`${src.module}: ${fxName} -> ${target.effect.name}, a stand-in, switched off at its defaults (${entry.why})`);
    return values;
  }
  const isSync = (c) => c && SYNC.test(c.name) && c.max === 1;
  const synced = srcFx.controls.some((c) => isSync(c) && src.values[c.pos] === 1);
  const syncCarried = synced && entry.moves.some((mv) => isSync(srcFx.controls.find((c) => c.pos === mv.from)) && src.values[mv.from] === 1);
  const changes = [];
  for (const mv of entry.moves) {
    let v = src.values[mv.from];
    if (synced && SYNCED.test(mv.name)) {
      if (syncCarried) { values[mv.to] = v; continue; }
      const def = target.effect.controls.find((c) => c.pos === mv.to)?.def;
      changes.push(`${mv.name} was set by tempo, now ${round(def)}`);
      values[mv.to] = def;
      continue;
    }
    if (mv.clamp && (v < mv.clamp[0] || v > mv.clamp[1])) {
      const was = v;
      v = Math.min(mv.clamp[1], Math.max(mv.clamp[0], v));
      changes.push(`${mv.name} limited ${round(was)} -> ${round(v)}`);
    }
    values[mv.to] = v;
  }
  const close = entry.match === "close";
  for (const d of entry.dropped ?? []) changes.push(`${d.name} dropped`);
  // Same or renamed: the effect is the one it was; a control the source lacks
  // starts at its default, which changes nothing worth telling.
  if (close) for (const f of entry.filled ?? []) changes.push(`${f.name} set to ${round(f.def)}`);
  // Same or renamed is the same effect under the other pedal's name: nothing
  // substituted, nothing to tell. Nor a close match that loses nothing in this
  // patch, keeps its name and has no reason to give (a range this patch stays
  // inside).
  if (changes.length || (close && (target.effect.name !== fxName || entry.why))) {
    const head = target.effect.name !== fxName ? `${fxName} -> ${target.effect.name}` : fxName;
    const why = close && entry.why ? ` (${entry.why})` : "";
    note(`${src.module}: ${head}${close ? ", a close match" : ""}${why}${changes.length ? `: ${changes.join(", ")}` : ""}`);
  }
  return values;
}
const round = (v) => Math.round(v * 100) / 100;

/**
 * Who gets a target module when several want it: one that's on before one
 * that's off, then one coming from the module of the same name, then the
 * earlier in the chain.
 */
function place(wants, chainPos) {
  const won = new Map(), lost = [];
  const rank = (w) => [w.on ? 0 : 1, w.natural ? 0 : 1, chainPos(w.src)];
  const sorted = [...wants].sort((a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
  for (const w of sorted) {
    const free = w.places.find((p) => !won.has(p));
    if (free === undefined) lost.push(w); else won.set(free, { ...w, at: free });
  }
  return { won, lost };
}

/**
 * Chain order on the target: modules in the order their sources play, and
 * each module with no source after the one before it in the target's own
 * default order.
 */
function chainOrder(srcOrder, placed, defaultOrder) {
  const out = [];
  for (const s of srcOrder) for (const [t, w] of placed) if (w.src.index === s) out.push(t);
  for (const t of defaultOrder) {
    if (out.includes(t)) continue;
    const before = defaultOrder.slice(0, defaultOrder.indexOf(t)).reverse().find((x) => out.includes(x));
    out.splice(before === undefined ? 0 : out.indexOf(before) + 1, 0, t);
  }
  return out;
}

// ---------------------------------------------------------------- GP-200 -> GP-50

const GP50_DEFAULT_ORDER = [0, 1, 2, 9, 3, 4, 5, 6, 7, 8];
const GP200_DEFAULT_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Notes kept with a sort key, so the report reads in playing order. */
function noteList() {
  const list = [];
  return {
    at: (key) => (t) => list.push([key, list.length, t]),
    sorted: () => [...list].sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]),
  };
}
const FIRST = -1, LAST = 100;

/** Source module name -> target module name, for each effect that went over (gp50/roundtrip.js reads it). */
const placedModules = (won, targetModules) => Object.fromEntries([...won].map(([at, w]) => [w.src.module, targetModules[at]]));

/**
 * A GP-200 .prst as a GP-50 .prst. Returns { prst, name, source, notes,
 * placed } (source: the name it had): notes say what was substituted,
 * dropped or limited, in playing order; placed: each source module whose
 * effect went over -> the target module it went to. Throws with the reason
 * if the patch can't be converted.
 */
export function gp200ToGp50(prst, map, { log = () => {} } = {}) {
  const p = readGp200(prst);
  const notes = noteList();
  const pos = (m) => p.order.indexOf(m.index);
  const name = shortenName(p.name);
  if (name !== p.name.trim()) notes.at(FIRST)(`Name shortened: "${p.name.trim()}" -> "${name}" (the GP-50 takes 10 characters)`);
  const onExp = new Set(p.exp.filter((e) => e.module !== NO_MODULE).map((e) => e.module));
  const wants = [];
  for (const m of p.modules) {
    if (m.module === "VOL") continue; // a volume pedal: the GP-50 has no such module, and no expression pedal
    const note = notes.at(pos(m));
    const k = hex(m.code);
    const fx = map.gp200[k];
    if (!fx) throw new Error(`${m.module}: effect code ${k} isn't in the effect map (newer firmware?)`);
    if (outOfScope(m.code)) { note(`${m.module}: ${fx.name} left out (NAM/SnapTone and user IRs aren't copied)${m.on ? "" : " (was off)"}`); continue; }
    const entry = map.toGp50[k];
    if (!entry) throw new Error(`${m.module}: ${fx.name} (${k}) has no entry in the effect map`);
    if (entry.match === "none") { note(`${m.module}: ${fx.name} left out, the GP-50 has nothing like it${m.on ? "" : " (was off)"}`); continue; }
    if (entry.match === "conflict") throw new Error(`${m.module}: ${fx.name} is marked "conflict" in the effect map (${entry.why}); listen first`);
    const to = entry.inModule?.[m.module]?.to ?? entry.to;
    const target = map.gp50[to];
    if (!target) throw new Error(`${m.module}: ${fx.name} goes to ${to}, which isn't a GP-50 effect`);
    wants.push({ src: m, entry, to, target, fx, on: m.on, natural: target.module === m.module, places: [GP50_MODULES.indexOf(target.module)] });
  }
  const { won, lost } = place(wants, pos);
  for (const w of lost) {
    const holder = won.get(w.places[0]);
    notes.at(pos(w.src))(`${w.src.module}: ${w.fx.name} left out${w.on ? "" : " (was off)"}: the GP-50 has one ${w.target.module} module, taken by ${holder.fx.name} from ${holder.src.module}`);
  }
  // Modules with no source keep the empty patch's effect, off.
  const empty = readGp50(gp50EmptyPrst());
  const modules = empty.modules.map((m) => ({ ...m, on: false }));
  for (const [at, w] of won) {
    const note = notes.at(pos(w.src));
    const out = modules[at];
    out.code = Number(w.to) >>> 0;
    out.values = convertEffect(w.src, w.fx, w.entry, { effect: w.target, width: GP50_VALUES }, note, w.fx.name);
    out.on = w.on && w.entry.match !== "stand-in";
    // DESIGN.md: a wah worked by the expression pedal is switched off.
    if (out.on && onExp.has(w.src.index) && w.fx.modules.includes("WAH")) {
      out.on = false;
      note(`${w.src.module}: ${w.target.name} switched off: the expression pedal worked it, and the GP-50 has none`);
    }
  }
  const order = chainOrder(p.order, won, GP50_DEFAULT_ORDER);
  const last = notes.at(LAST);
  const extraExp = p.exp.filter((e) => e.module !== NO_MODULE && !(GP200_DEFAULT_EXP[e.id]?.[0] === e.module && GP200_DEFAULT_EXP[e.id]?.[1] === e.control));
  for (const e of extraExp) last(`EXP: its assignment to ${GP200_MODULES[e.module] ?? `module ${e.module}`} not carried (the GP-50 has no expression pedal)`);
  // CTRL (DESIGN.md): 1 and 2 only (the GP-50 has two), at most 3 modules
  // each: the carried ones highest in the developer's ranking are kept.
  const ctrlMasks = [0, 0];
  p.ctrlMasks.forEach((raw, n) => {
    if (raw >>> 11) log(`GP-200 CTRL ${n + 1}: bits above the modules set (0x${raw.toString(16)}), meaning unknown, not carried`);
    const mods = GP200_MODULES.map((_, i) => i).filter((i) => (raw >>> i) & 1).sort((a, b) => CTRL_RANK.indexOf(GP200_MODULES[a]) - CTRL_RANK.indexOf(GP200_MODULES[b]));
    if (!mods.length) return;
    if (n > 1) { last(`CTRL ${n + 1}: ${mods.map((i) => GP200_MODULES[i]).join(" + ")} not carried: the GP-50 has CTRL 1 and 2 only`); return; }
    const kept = [];
    for (const i of mods) {
      const what = `CTRL ${n + 1}: ${GP200_MODULES[i]}`;
      const hit = [...won].find(([, w]) => w.src.index === i);
      if (!hit) { last(`${what} not carried: that module isn't in the GP-50 patch`); continue; }
      const [at, w] = hit;
      if (w.entry.match === "stand-in") { last(`${what} not carried: its stand-in stays off`); continue; }
      if (w.on && !modules[at].on) { last(`${what} not carried: the wah stays off (the expression pedal worked it)`); continue; }
      if (!kept.includes(at)) {
        if (kept.length === GP50_CTRL_MAX) { last(`${what} not carried: a GP-50 CTRL switches ${GP50_CTRL_MAX} modules at most, and CTRL ${n + 1} has ${kept.map((k) => GP50_MODULES[k]).join(", ")}`); continue; }
        kept.push(at);
      }
      if (GP50_MODULES[at] !== GP200_MODULES[i]) last(`${what} switches the GP-50's ${GP50_MODULES[at]} module`);
    }
    ctrlMasks[n] = kept.reduce((m, at) => m | (1 << at), 0);
  });
  const volume = Math.min(100, p.volume);
  if (volume !== p.volume) last(`Patch volume limited ${p.volume} -> ${volume}`);
  const list = notes.sorted();
  log(`Convert GP-200 "${p.name}" -> GP-50 "${name}": ${list.length} note(s); order ${order.map((i) => GP50_MODULES[i]).join(" ")}; on ${modules.filter((m) => m.on).map((m) => m.module).join(" ") || "none"}`);
  return { prst: writeGp50({ name, volume, tempo: p.tempo, order, modules, ctrlMasks }), name, source: p.name.trim(), notes: list, placed: placedModules(won, GP50_MODULES) };
}

// ---------------------------------------------------------------- GP-50 -> GP-200

/** A GP-50 .prst as a GP-200 .prst: { prst, name, source, notes, placed } (as gp200ToGp50), or throws with the reason. */
export function gp50ToGp200(prst, map, { log = () => {} } = {}) {
  const p = readGp50(prst);
  const notes = noteList();
  const pos = (m) => p.order.indexOf(m.index);
  const base = readGp200(skeletonBytes());
  const wants = [];
  for (const m of p.modules) {
    const note = notes.at(pos(m));
    const k = hex(m.code);
    const fx = map.gp50[k];
    if (!fx) throw new Error(`${m.module}: effect code ${k} isn't in the effect map (newer firmware?)`);
    if (outOfScope(m.code) || m.module === "NAM") { if (m.on) note(`${m.module}: ${fx.name} left out (NAM/SnapTone and user IRs aren't copied)`); continue; }
    const entry = map.toGp200[k];
    if (!entry) throw new Error(`${m.module}: ${fx.name} (${k}) has no entry in the effect map`);
    if (entry.match === "none") { note(`${m.module}: ${fx.name} left out, the GP-200 has nothing like it${m.on ? "" : " (was off)"}`); continue; }
    if (entry.match === "conflict") throw new Error(`${m.module}: ${fx.name} is marked "conflict" in the effect map (${entry.why}); listen first`);
    const to = entry.inModule?.[m.module]?.to ?? entry.to;
    const target = map.gp200[to];
    if (!target) throw new Error(`${m.module}: ${fx.name} goes to ${to}, which isn't a GP-200 effect`);
    const mods = target.modules.filter((x) => GP200_MODULES.includes(x) && x !== "VOL");
    const natural = mods.includes(m.module);
    const places = (natural ? [m.module, ...mods.filter((x) => x !== m.module)] : mods).map((x) => GP200_MODULES.indexOf(x));
    wants.push({ src: m, entry, to, target, fx, on: m.on, natural, places });
  }
  const { won, lost } = place(wants, pos);
  for (const w of lost) notes.at(pos(w.src))(`${w.src.module}: ${w.fx.name} left out${w.on ? "" : " (was off)"}: no free ${w.target.modules.join("/")} module on the GP-200`);
  // Modules with no source keep the skeleton's effect, off; its volume pedal stays as it is.
  const modules = base.modules.map((m) => ({ ...m, on: m.module === "VOL" ? m.on : false }));
  for (const [at, w] of won) {
    const note = notes.at(pos(w.src));
    const out = modules[at];
    out.code = Number(w.to) >>> 0;
    out.values = convertEffect(w.src, w.fx, w.entry, { effect: w.target, width: GP200_VALUES }, note, w.fx.name);
    out.on = w.on && w.entry.match !== "stand-in";
    if (GP200_MODULES[at] !== w.src.module) note(`${w.src.module}: ${w.target.name} goes in the GP-200's ${GP200_MODULES[at]} module`);
  }
  const order = chainOrder(p.order, won, GP200_DEFAULT_ORDER);
  const empty = readGp50(gp50EmptyPrst());
  const last = notes.at(LAST);
  // CTRL 1 and 2 to the GP-200's CTRL 1 and 2, every module (a GP-200 CTRL
  // holds them all); CTRL 3-8 stay the skeleton's (none).
  const ctrlMasks = [...base.ctrlMasks];
  p.ctrlMasks.forEach((mask, n) => {
    for (const m of p.modules.filter((x) => (mask >>> x.index) & 1).sort((a, b) => pos(a) - pos(b))) {
      const what = `CTRL ${n + 1}: ${m.module}`;
      const hit = [...won].find(([, w]) => w.src.index === m.index);
      if (!hit) { last(`${what} not carried: that module isn't in the GP-200 patch`); continue; }
      const [at, w] = hit;
      if (w.entry.match === "stand-in") { last(`${what} not carried: its stand-in stays off`); continue; }
      ctrlMasks[n] |= 1 << at;
      if (GP200_MODULES[at] !== m.module) last(`${what} switches the GP-200's ${GP200_MODULES[at]} module`);
    }
  });
  if (p.exp.some((b, i) => b.join() !== empty.exp[i].join())) last("EXP: settings not carried (where the GP-50 keeps them isn't confirmed yet)");
  const name = p.name.trim();
  const list = notes.sorted();
  log(`Convert GP-50 "${p.name}" -> GP-200 "${name}": ${list.length} note(s); order ${order.map((i) => GP200_MODULES[i]).join(" ")}; on ${modules.filter((m) => m.on).map((m) => m.module).join(" ") || "none"}`);
  return { prst: writeGp200({ name, tempo: p.tempo, volume: p.volume, order, modules, ctrlMasks }), name, source: p.name.trim(), notes: list, placed: placedModules(won, GP200_MODULES) };
}
