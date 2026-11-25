// Round trips with no pedal (gp50/roundtrip.js), the A/B pairs for listening
// on the GP-200 (gp50/ab-pairs.js) and their tool (tools/round-trip.js).
// Patches are built from the GP-200 skeleton and the GP-50 empty patch, with
// the repo's map; files go to temp folders.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { audibleChanges, B_MARK, pairFiles, pickPairs, renamed } from "../gp50/ab-pairs.js";
import { gp50EmptyPrst, readGp200, readGp50, writeGp200, writeGp50 } from "../gp50/convert.js";
import { compare, explain, mapAsymmetries, roundTrip } from "../gp50/roundtrip.js";
import { isPrst, prstChecksum, CHECKSUM_OFF } from "../src/core/prst.js";
import { skeletonBytes } from "../src/core/skeleton.js";
import { labelToSlot } from "../src/core/slots.js";
import { readZip } from "../src/core/unzip.js";
import { orderEntries, planUpload } from "../src/core/upload.js";
import { createZip } from "../src/core/zip.js";
import { main } from "../tools/round-trip.js";

const map = JSON.parse(readFileSync(new URL("../gp50/effect-map.json", import.meta.url), "utf8"));
const code = (side, name) => Number(Object.entries(map[side]).find(([, e]) => e.name === name)[0]) >>> 0;
const setFx = (m, side, name) => {
  m.code = code(side, name);
  m.values = m.values.map(() => 0);
  for (const c of map[side][`0x${m.code.toString(16).toUpperCase().padStart(8, "0")}`].controls) m.values[c.pos] = c.def;
};
/** A GP-200 patch: every module off, then `edit(parts)`. */
function gp200(edit = () => {}) {
  const p = readGp200(skeletonBytes());
  for (const m of p.modules) if (m.module !== "VOL") m.on = false;
  p.name = "Test";
  edit(p);
  return writeGp200(p);
}
function gp50(edit = () => {}) {
  const p = readGp50(gp50EmptyPrst());
  p.name = "Test";
  edit(p);
  return writeGp50(p);
}
const mod = (p, name) => p.modules.find((m) => m.module === name);
const on = (p, module, side, fx) => { const m = mod(p, module); setFx(m, side, fx); m.on = true; return m; };

test("round trip: an exact GP-50 patch comes back with no difference, and settles", () => {
  const prst = gp50((p) => { on(p, "NR", "gp50", "Gate"); on(p, "AMP", "gp50", "UK 800"); p.tempo = 97; p.volume = 63; });
  const r = roundTrip(prst, "GP-50", map);
  assert.deepEqual(r.diffs, []);
  assert.equal(r.settles, true);
});

test("round trip: Plate L comes back as the GP-50's Plate, explained by both reports; the map shows it on its own", () => {
  const r = roundTrip(gp50((p) => on(p, "RVB", "gp50", "Plate L")), "GP-50", map);
  const d = r.diffs.find((x) => x.area === "effect");
  assert.deepEqual([d.module, d.from, d.to, d.verdict], ["RVB", "Plate L", "Plate", "explained"]);
  assert.match(d.why, /Plate L -> Plate, a close match.*\| RVB: Plate, a close match/);
  assert.equal(r.settles, true, "Plate stays Plate");
  // The map alone: GP-50 effects whose match's match is another effect. A new
  // one here is a change to the map that the developer should hear about.
  assert.deepEqual(mapAsymmetries(map).filter((a) => a.side === "GP-50").map((a) => `${a.from} -> ${a.via} -> ${a.back}`), ["Plate L -> Plate -> Plate"]);
});

test("round trip: a wah on the expression pedal counts as off (decision 3), so an off COMP keeps the PRE at once, and it settles", () => {
  const prst = gp200((p) => { on(p, "WAH", "gp200", "P-Wah"); setFx(mod(p, "PRE"), "gp200", "COMP"); on(p, "AMP", "gp200", "UK 800"); });
  const r = roundTrip(prst, "GP-200", map);
  assert.ok(r.diffs.every((d) => d.verdict !== "unexplained"), JSON.stringify(r.diffs.filter((d) => d.verdict === "unexplained")));
  assert.ok(r.diffs.some((d) => d.area === "effect" && d.module === "WAH" && d.from === "P-Wah" && /left out \(on, but would be off on the GP-50/.test(d.why)), JSON.stringify(r.diffs));
  assert.equal(r.settles, true, JSON.stringify(r.again));
});

test("compare finds each kind of change, and says how much; explain sorts them, and an unreported change stays unexplained", () => {
  const S = "GP-200";
  const base = gp200((p) => { on(p, "AMP", "gp200", "UK 800"); on(p, "NR", "gp200", "Gate 1"); p.tempo = 120; p.ctrlMasks[0] = 1 << 3; });
  const a = readGp200(base);
  assert.deepEqual(compare(a, readGp200(base), S, map), [], "identical");
  const changed = (edit) => { const p = readGp200(base); edit(p); return compare(a, readGp200(writeGp200(p)), S, map); };
  const areas = (ds) => ds.map((d) => d.area);
  assert.deepEqual(areas(changed((p) => { p.tempo = 121; })), ["tempo"]);
  assert.deepEqual(areas(changed((p) => { p.name = "Other"; })), ["name"]);
  assert.deepEqual(areas(changed((p) => { mod(p, "AMP").values[0] += 1; })), ["setting"]);
  assert.deepEqual(areas(changed((p) => { mod(p, "NR").on = false; })), ["on"]);
  assert.deepEqual(areas(changed((p) => { setFx(mod(p, "AMP"), "gp200", "Dark DLX"); })), ["effect"]);
  assert.deepEqual(areas(changed((p) => { [p.order[3], p.order[4]] = [p.order[4], p.order[3]]; })), ["order"]);
  assert.deepEqual(areas(changed((p) => { p.ctrlMasks[0] = 1 << 4; })), ["ctrl"]);
  assert.deepEqual(areas(changed((p) => { p.ctrlMasks[1] = 1 << 12; })), ["ctrl-high"]);
  // A setting off by one bit of a float is still a difference.
  const f = changed((p) => { const v = new Float32Array([mod(p, "AMP").values[1]]); new Uint32Array(v.buffer)[0] ^= 1; mod(p, "AMP").values[1] = v[0]; });
  assert.equal(f.length, 1);

  const ctx = (notes1 = [], notes2 = []) => ({ side: S, notes1, notes2, placed1: { AMP: "AMP", NR: "NR" }, map, a });
  const ampSetting = changed((p) => { mod(p, "AMP").values[0] += 1; })[0];
  assert.equal(explain(ampSetting, ctx()).verdict, "unexplained");
  assert.equal(explain(ampSetting, ctx(["AMP: UK 800, a close match: Volume limited 60 -> 50"])).verdict, "unexplained", "a note for the module, but naming another control");
  const named = map.gp200[`0x${a.modules[3].code.toString(16).toUpperCase().padStart(8, "0")}`].controls.find((c) => c.pos === ampSetting.pos).name;
  assert.equal(explain(ampSetting, ctx([`AMP: UK 800, a close match: ${named} limited 1 -> 2`])).verdict, "explained");
  assert.equal(explain(ampSetting, ctx([], [`AMP: UK 800 left out (was off): x`])).verdict, "explained", "left out on the way back explains every setting");
  assert.equal(explain({ area: "tempo", from: 120, to: 121 }, ctx(["anything"])).verdict, "unexplained");
  assert.equal(explain({ area: "setting", module: "VOL", control: "Volume", pos: 0 }, ctx()).verdict, "by rule");
  assert.equal(explain({ area: "ctrl", n: 1 }, ctx(["CTRL 1: DST not carried: x"])).verdict, "explained");
  assert.equal(explain({ area: "ctrl", n: 2 }, ctx(["CTRL 1: DST not carried: x"])).verdict, "unexplained");
});

test("A/B pairs: each rule picked from its cleanest patch; a check pair with the amp on; user IR patches left out", () => {
  const lowCut = (p, v) => { const cab = mod(p, "CAB"); cab.values[5] = v; };
  const entries = [
    // 0: exact apart from a cab whose cut filters are off: the check pair.
    gp200((p) => { on(p, "NR", "gp200", "Gate 1"); on(p, "AMP", "gp200", "UK 800"); on(p, "CAB", "gp200", "TWD CP"); }),
    // 1: a stand-in, alone: not needed once 3 is in.
    gp200((p) => { on(p, "PRE", "gp200", "Step Filter"); on(p, "AMP", "gp200", "UK 800"); }),
    // 2: a close amp, and a cab's Low Cut that is on (heard).
    gp200((p) => { on(p, "AMP", "gp200", "Dark DLX"); on(p, "CAB", "gp200", "TWD CP"); lowCut(p, 80); }),
    // 3: a stand-in and a close amp: the second close amp wanted, and it covers the stand-in too.
    gp200((p) => { on(p, "PRE", "gp200", "Step Filter"); on(p, "AMP", "gp200", "Dark DLX"); }),
    // 4: a user IR: left out, whatever else it has.
    gp200((p) => { on(p, "AMP", "gp200", "Dark Vibra"); on(p, "CAB", "gp200", "User IR"); }),
  ].map((data, i) => ({ slot: i, name: `${i + 1}A_t${i}.prst`, data }));
  const ch = (i) => audibleChanges(roundTrip(entries[i].data, "GP-200", map), readGp200(entries[i].data), map);
  assert.deepEqual(ch(0).kinds, [], "a cab with its cut filters off: nothing heard");
  assert.ok(ch(2).kinds.includes("close match: CAB") && ch(2).kinds.includes("close match: AMP"), ch(2).kinds.join());
  assert.match(ch(4).skip, /user IR/);
  const p = pickPairs(entries, map, { maxPairs: 10 });
  assert.equal(p.candidates, 4);
  assert.deepEqual(p.pairs.map((x) => [x.slot, !!x.control]), [[0, true], [2, false], [3, false]]);
  assert.deepEqual(p.uncovered, ["close match: CAB (1 more wanted)"]);
  assert.equal(pickPairs(entries, map, { maxPairs: 2 }).pairs.length, 2, "capped (check pair included)");
});

test("A/B pairs: of two patches with a rule, the one with fewer other changes is taken", () => {
  const ctrl3 = (p) => { p.ctrlMasks[2] = 1 << 3; }; // CTRL 3 on AMP: not carried
  const entries = [
    gp200((p) => { on(p, "PRE", "gp200", "Step Filter"); on(p, "AMP", "gp200", "UK 800"); }), // P: stand-in
    gp200((p) => { on(p, "AMP", "gp200", "UK 800"); ctrl3(p); }), // R: CTRL 3-8
    gp200((p) => { on(p, "PRE", "gp200", "Step Filter"); on(p, "AMP", "gp200", "UK 800"); ctrl3(p); }), // Q: both
  ].map((data, i) => ({ slot: i, name: `${i + 1}A_t${i}.prst`, data }));
  assert.deepEqual(pickPairs(entries, map).pairs.map((x) => x.slot), [0, 1], "P and R, not Q");
});

test("A/B pair files: A unchanged, B named with the mark and valid, side by side from the start; Restore keeps that order", () => {
  const data = gp200((p) => { p.name = "A Long Name Here"; on(p, "PRE", "gp200", "Step Filter"); on(p, "AMP", "gp200", "UK 800"); });
  const picked = pickPairs([{ slot: 5, name: "2B_x.prst", data }], map);
  const { files, rows } = pairFiles(picked.pairs, labelToSlot("51-A"));
  assert.deepEqual(files.map((f) => f.name), ["51A_A Long Name Here.prst", "51B_A Long Name H~50.prst"]);
  assert.deepEqual(files[0].data, data, "A is the source, byte for byte");
  assert.equal(readGp200(files[1].data).name, `A Long Name H${B_MARK}`, "16 characters at most");
  assert.ok(isPrst(files[1].data));
  assert.deepEqual([rows[0].a, rows[0].b, rows[0].kinds], ["51A", "51B", "stand-in"]);
  const plan = planUpload(orderEntries(files).ordered, labelToSlot("51-A"));
  assert.deepEqual(plan.items.map((i) => i.label), ["51A", "51B"]);
  // renamed() redoes the checksum: a broken one would fail isPrst.
  const r = renamed(data, "X");
  assert.equal((r[CHECKSUM_OFF] << 8) | r[CHECKSUM_OFF + 1], prstChecksum(r));
});

function session(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "round-trip-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const printed = [];
  return { dir, printed, run: (...a) => main(a, { print: (l) => printed.push(l) }), zip: (name, files) => { const f = path.join(dir, name); writeFileSync(f, createZip(files)); return f; } };
}

test("round-trip tool: reports, CSV and log for a GP-50 backup; pairs zip for a GP-200 one; wrong commands refused (exit 2)", async (t) => {
  const s = session(t);
  const g50 = s.zip("g50.zip", [{ name: "00-a.prst", data: gp50((p) => on(p, "AMP", "gp50", "UK 800")) }, { name: "01-b.prst", data: gp50((p) => on(p, "RVB", "gp50", "Plate L")) }]);
  assert.equal(await s.run(g50, "--out", s.dir), 0, s.printed.join("\n"));
  assert.match(s.printed.join("\n"), /Round trip GP-50: 2 patches; 0 unexplained, 0 by rule, 1 explained; 0 refused; 2 settle on a second trip\. PASSED/);
  const md = readFileSync(path.join(s.dir, readdirSync(s.dir).find((f) => /^roundtrip_gp50_.*\.md$/.test(f))), "utf8");
  assert.match(md, /Unexplained differences: 0/);
  assert.match(md, /\| RVB: Plate L -> Plate \| 1 \| 1 \|/);
  assert.match(md, /Plate L -> Plate -> Plate/);
  assert.ok(readdirSync(s.dir).some((f) => /^roundtrip_gp50_.*\.csv$/.test(f)) && readdirSync(s.dir).some((f) => /^roundtrip_gp50_.*\.log$/.test(f)));

  const g200 = s.zip("g200.zip", [
    { name: "1A_one.prst", data: gp200((p) => { p.name = "one"; on(p, "PRE", "gp200", "Step Filter"); on(p, "AMP", "gp200", "UK 800"); }) },
    { name: "1B_two.prst", data: gp200((p) => { p.name = "two"; on(p, "AMP", "gp200", "Dark DLX"); }) },
  ]);
  assert.equal(await s.run(g200, "--out", s.dir, "--pairs", "51-A"), 0, s.printed.join("\n"));
  const pz = readdirSync(s.dir).find((f) => /^gp200_ab_pairs_.*\.zip$/.test(f));
  assert.deepEqual([...(await readZip(readFileSync(path.join(s.dir, pz))))].map(([n]) => n), ["51A_one.prst", "51B_one~50.prst", "51C_two.prst", "51D_two~50.prst"]);
  assert.ok(readdirSync(s.dir).some((f) => /^listening_ab_.*\.csv$/.test(f)));

  for (const [args, why] of [
    [[], /usage/], [[g50], /usage/], [[g50, "--out", path.join(s.dir, "nope")], /usage/],
    [[g50, "--out", s.dir, "--pairs", "51-A"], /for GP-200 backups/], [[g200, "--out", s.dir, "--pairs", "99-Z"], /--pairs 99-Z/],
    [[g200, "--out", s.dir, "--max-pairs", "1"], /--max-pairs/], [[s.zip("mixed.zip", [{ name: "a.prst", data: gp50() }, { name: "b.prst", data: gp200() }]), "--out", s.dir], /one pedal/],
    [[g200, "--out", s.dir, "--pairs", "64-C"], /don't fit before 64-D/],
  ]) {
    s.printed.length = 0;
    assert.equal(await s.run(...args), 2, args.join(" "));
    assert.match(s.printed.join("\n"), why, args.join(" "));
  }
});

test("round-trip tool: a patch the converter refuses fails the run (exit 1) and is listed", async (t) => {
  const s = session(t);
  const bad = gp200((p) => { mod(p, "AMP").code = 0x07fffff0; mod(p, "AMP").on = true; });
  const f = s.zip("bad.zip", [{ name: "1A_bad.prst", data: bad }, { name: "1B_ok.prst", data: gp200() }]);
  assert.equal(await s.run(f, "--out", s.dir), 1);
  assert.match(s.printed.join("\n"), /1 refused.*FAILED/);
  const md = readFileSync(path.join(s.dir, readdirSync(s.dir).find((x) => x.endsWith(".md"))), "utf8");
  assert.match(md, /Refused: 1A_bad\.prst: AMP: effect code 0x07FFFFF0 isn't in the effect map/);
});
