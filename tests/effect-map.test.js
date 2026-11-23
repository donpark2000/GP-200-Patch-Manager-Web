// The GP-200 <-> GP-50 effect map (stage 2): parsing Valeton's files,
// classifying each effect, moving settings, and catching a broken map.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { buildMap, checkMap, hex, mapControls, outOfScope, parseGp200Descriptions, parseGp200Xml, parseGp50Json, patchEffects, renderReview } from "../gp50/effect-map.js";
import { buildPrst } from "../gp50/protocol.js";
import { checkPatches, DEFAULT_GP200, DEFAULT_GP50, makeFiles, OUT_JSON, OUT_MD, stringify } from "../tools/make-effect-map.js";

// Small stand-ins for Valeton's files, in their real shapes (DEV_JOURNAL.md, 2026-11-23).
const XML = `<?xml version="1.0" encoding="utf-8" ?>
<GP-200>
  <Catalog Name = "CAB">
    <Alg Name="SUP Star" Module="CAB" Code="167772185" Index="0">
      <Knob  Name = "Volume"  idx = "0" ID = "1" default = "50" Dmin = "0" Dmax = "100" Type = "1" step = "1" />
      <Knob  Name = "Low Cut"  idx = "1" ID = "5" default = "19" Dmin = "19" Dmax = "2000" Type = "1" step = "1" />
      <Knob  Name = "High Cut"  idx = "2" ID = "6" default = "20001" Dmin = "2000" Dmax = "20001" Type = "1" step = "1" />
    </Alg>
  </Catalog>
  <Catalog Name = "DLY">
    <Alg Name="Pure" Module="DLY" Code="184549376" Index="0">
      <Knob  Name = "Mix"  idx = "0" ID = "0" default = "20" Dmin = "0" Dmax = "100" Type = "1" step = "1" />
      <Knob  Name = "Time"  idx = "1" ID = "1" default = "500" Dmin = "20" Dmax = "4000" Type = "1" step = "1" />
      <Switch Name = "Sync" default = "0" idx = "2" ID = "2" Type = "3">
        <Menu Name = "OFF" ID= "0" />
        <Menu Name = "ON" ID= "1" />
      </Switch>
    </Alg>
    <Alg Name="Wow &amp; Echo" Module="DLY" Code="184549409" Index="1">
      <Knob  Name = "Mix"  idx = "0" ID = "0" default = "20" Dmin = "0" Dmax = "100" Type = "1" step = "1" />
    </Alg>
  </Catalog>
  <Catalog Name = "AMP">
    <Alg Name="SnapTone 1" Module="AMP" Code="251658240" Index="0">
      <Knob  Name = "Gain"  idx = "0" ID = "0" default = "50" Dmin = "0" Dmax = "100" Type = "1" step = "1" />
    </Alg>
  </Catalog>
  <Catalog Name = "EQ">
    <Alg Name="Guitar EQ 1" Module="EQ" Code="16777269" Index="0">
      <Slider Name = "125Hz" default = "0" idx = "0" ID = "0"  Dmin = "-50" Dmax = "50" Type = "1" step = "1.0" />
    </Alg>
  </Catalog>
</GP-200>`;
const DESC = `<Modules><Catalog Name = "CAB"><Algorithm Name="SUP Star" ID="167772185" Index="0" description="Based on the Mesa/Boogie® Lonestar* 2x12&quot; cabinet. More text."></Algorithm>
<Algorithm Name="Pure" ID="184549376" Index="0" description="A clean digital delay."></Algorithm></Catalog></Modules>`;
const alg = (name, algId, min, max, def, extra = {}) => ({ name, algId: String(algId), sync: "-1", knobId: "-1", defaultValue: String(def), valueRange: `${min}-${max}`, min: String(min), max: String(max), step: "1", widgetType: 0, ...extra });
const JSON50 = JSON.stringify({ modules: [
  { name: "CAB", moduleId: 4, module: [{ fxid: 167772185, fxtitle: "SUP Star 2x12", name: "SUP Star 2x12", origin: "", alg: [alg("VOL", 0, 0, 100, 50)] }] },
  { name: "DLY", moduleId: 7, module: [
    { fxid: 184549376, fxtitle: "Pure Eko", name: "Pure", origin: "", alg: [alg("Mix", 0, 0, 100, 20), alg("Time", 1, 20, 1000, 500, { sync: "2" }), alg("Sync", 2, 0, 1, 0, { widgetType: 1, valueRange: "Off/On" })] },
    { fxid: 184549395, fxtitle: "Backmask", name: "Rev Echo", origin: "", alg: [alg("Mix", 0, 0, 100, 20)] },
  ] },
  { name: "EQ", moduleId: 5, module: [{ fxid: 16777269, fxtitle: "Guitar EQ 1", name: "Guitar EQ 1", origin: "Original", alg: [alg("125Hz", 0, -50, 50, 0)] }] },
  { name: "N->S", moduleId: 9, module: [{ fxid: 251658240, fxtitle: "SnapTone 1", name: "Empty", origin: "", alg: [alg("Gain", 0, 0, 100, 50)] }] },
] });
const parsed = () => ({ gp200: parseGp200Xml(XML), gp50: parseGp50Json(JSON50), descriptions: parseGp200Descriptions(DESC) });

test("effect map: Valeton's files parse into codes, positions, ranges and menus", () => {
  const { gp200, gp50, descriptions } = parsed();
  const cab = gp200.get(0x0a000019);
  assert.deepEqual(cab.controls.map((c) => [c.name, c.pos]), [["Volume", 1], ["Low Cut", 5], ["High Cut", 6]], "the position is the ID, not idx");
  assert.deepEqual(gp200.get(0x0b000000).controls[2], { pos: 2, name: "Sync", def: 0, menu: ["OFF", "ON"], min: 0, max: 1, step: 1 });
  assert.equal(gp200.get(0x0b000021).name, "Wow & Echo", "XML entities are decoded");
  assert.equal(gp200.get(0x01000035).controls.length, 1, "Slider controls count (the GP-200's EQs)");
  assert.equal(descriptions.get(0x0a000019), 'Mesa/Boogie Lonestar 2x12" cabinet', "only the product named after 'Based on'");
  assert.equal(descriptions.has(0x0b000000), false, "a description that doesn't start 'Based on' isn't kept");
  assert.equal(gp50.get(0x0b000000).controls[1].syncPos, 2);
  assert.equal(gp50.get(0x0f000000).module, "NAM");
  assert.throws(() => parseGp50Json(JSON.stringify({ modules: [{ name: "X", module: [{ fxid: 1, alg: [] }, { fxid: 1, alg: [] }] }] })), /twice/);
});

test("effect map: a setting moves to its position on the other pedal; missing ones are dropped or set to default", () => {
  const { gp200, gp50 } = parsed();
  const there = mapControls(gp50.get(0x0a000019), gp200.get(0x0a000019));
  assert.deepEqual(there.moves, [{ from: 0, to: 1, name: "VOL", toName: "Volume" }]);
  assert.deepEqual(there.filled.map((c) => [c.name, c.def]), [["Low Cut", 19], ["High Cut", 20001]]);
  const back = mapControls(gp200.get(0x0a000019), gp50.get(0x0a000019));
  assert.deepEqual(back.dropped.map((c) => c.name), ["Low Cut", "High Cut"]);
  const time = mapControls(gp200.get(0x0b000000), gp50.get(0x0b000000)).moves.find((m) => m.name === "Time");
  assert.deepEqual(time.clamp, [20, 1000], "a narrower range on the other pedal is a limit");
});

test("effect map: classes in both directions, choices, conflicts and out-of-scope codes", () => {
  const choices = {
    conflicts: { "0x0A000019": "Two different cabs?" },
    toGp200: { "0x0B000013": { name: "Rev Echo", to: "0x0B000000", toName: "Pure", why: "Nearest delay" } },
  };
  const map = buildMap({ ...parsed(), choices });
  assert.deepEqual(checkMap(map), []);
  assert.equal(map.toGp200["0x0B000000"].match, "same", "every GP-50 setting fits the GP-200");
  assert.equal(map.toGp50["0x0B000000"].match, "close", "the GP-200's 4000 ms doesn't fit the GP-50");
  assert.equal(map.toGp200["0x0B000013"].match, "close");
  assert.equal(map.toGp200["0x0B000013"].why, "Nearest delay");
  assert.equal(map.toGp200["0x0A000019"].match, "conflict");
  assert.equal(map.toGp50["0x0B000021"].match, "none");
  assert.equal(map.toGp50["0x0F000000"].match, "out of scope");
  assert.equal(map.toGp200["0x0F000000"].match, "out of scope");
  assert.ok(outOfScope(0x0a100003) && !outOfScope(0x0a000003), "user IRs are out of scope, cabs aren't");
  const page = renderReview(map);
  assert.match(page, /\| GP-50 to GP-200 \| 2 \| 0 \| 1 \| 1 \| 0 \| 1 \|/, "same: Pure, Guitar EQ 1; close: Rev Echo; conflict: SUP Star; out of scope: SnapTone");
  assert.match(page, /\| GP-200 to GP-50 \| 1 \| 0 \| 1 \| 1 \| 1 \| 1 \|/);
  assert.match(page, /Nearest delay/);
  assert.match(page, /Two different cabs\?/);
  assert.match(page, /\*\*DLY\*\* \(1\): Wow & Echo/);
});

test("effect map: a stale or wrong choice is refused, naming it", () => {
  const bad = (pick) => () => buildMap({ ...parsed(), choices: { toGp200: { "0x0B000013": pick } } });
  assert.throws(bad({ name: "Rev Echo", to: "0x0B999999", toName: "x" }), /isn't on the other pedal/);
  assert.throws(bad({ name: "Old name", to: "0x0B000000", toName: "Pure" }), /says Old name -> Pure, but Valeton's files say Rev Echo -> Pure/);
  assert.throws(bad({ name: "Rev Echo", to: "0x0B000000", toName: "Pure", controls: { Mix: "Level" } }), /pairs controls Mix -> Level/);
});

test("effect map: checkMap reports each kind of broken entry", () => {
  const good = buildMap(parsed());
  const broken = (edit) => { const m = structuredClone(good); edit(m); return checkMap(m); };
  assert.match(broken((m) => delete m.toGp50["0x0B000000"]).join("\n"), /0x0B000000 Pure has no entry/);
  assert.match(broken((m) => (m.toGp50["0x0B000000"].moves[1].to = 9)).join("\n"), /moves to position 9, which Pure doesn't have/);
  assert.match(broken((m) => (m.toGp200["0x0A000019"].moves[0].to = 22)).join("\n"), /outside 0-14/);
  assert.match(broken((m) => delete m.toGp50["0x0B000000"].moves[1].clamp).join("\n"), /Time needs a clamp to 20-1000/);
  assert.match(broken((m) => (m.toGp50["0x0A000019"].match = "same")).join("\n"), /is "same" but loses a setting/);
  assert.match(broken((m) => m.toGp50["0x0A000019"].dropped.pop()).join("\n"), /accounts for 2 of 3 controls/);
  assert.match(broken((m) => (m.toGp50["0x0B000000"].match = "maybe")).join("\n"), /has match "maybe"/);
  assert.match(broken((m) => (m.toGp50["0x12345678"] = { match: "none" })).join("\n"), /entry 0x12345678 isn't an effect/);
});

// Patches in each pedal's real layout: GP-200 blocks at 0xA0, 72 bytes each; GP-50 records 0x3003/0x3004.
function gp200Patch(code, values) {
  const b = new Uint8Array(1224);
  b.set([0x54, 0x53, 0x52, 0x50]);
  const dv = new DataView(b.buffer);
  const o = 0xa0 + 72 * 5; // CAB
  dv.setUint32(o + 8, code, true);
  values.forEach((v, k) => dv.setFloat32(o + 12 + 4 * k, v, true));
  return b;
}
function gp50Patch(codes, values) {
  const body = new Uint8Array(511);
  const dv = new DataView(body.buffer);
  dv.setUint16(0, 2, true); dv.setUint16(2, 4 + 40 + 4 + 320, true);
  dv.setUint16(4, 0x3003, true); dv.setUint16(6, 40, true);
  codes.forEach((c, m) => dv.setUint32(8 + 4 * m, c, true));
  dv.setUint16(48, 0x3004, true); dv.setUint16(50, 320, true);
  values.forEach((row, m) => row.forEach((v, k) => dv.setFloat32(52 + 32 * m + 4 * k, v, true)));
  return buildPrst("Test", body);
}

test("effect map: real patches of either pedal are read and checked against the map", () => {
  const map = buildMap(parsed());
  const fx = patchEffects(gp200Patch(0x0a000019, [0, 60, 0, 0, 0, 80, 9000]));
  assert.equal(fx.length, 11);
  assert.equal(fx[5].module, "CAB");
  assert.equal(fx[5].values[5], 80);
  const codes = [0x0a000019, 0x0b000000, 0x0b000000];
  const g = gp50Patch(codes, [[70], [20, 500, 0], [20, 4, 1]]);
  const f50 = patchEffects(g);
  assert.equal(f50.length, 10);
  assert.equal(f50[4].module, "CAB");
  assert.equal(f50[0].code, 0x0a000019);
  const r = checkPatches(map, [
    { name: "ok200", data: gp200Patch(0x0a000019, [0, 60, 0, 0, 0, 80, 9000]) },
    { name: "low200", data: gp200Patch(0x0a000019, [0, 60, 0, 0, 0, 5, 9000]) },
    { name: "ok50", data: g },
    { name: "junk", data: new Uint8Array(10) },
  ]);
  assert.equal(r.files, 3);
  assert.equal(r.skipped, 1);
  assert.equal(r.synced, 1, "Time = 4 with Sync on is a note length, not 4 ms");
  assert.deepEqual(r.outOfRange, ["low200 CAB SUP Star Low Cut=5 (19-2000)"]);
  // The GP-50 patch's other 7 modules hold code 0, which isn't in this small map.
  assert.equal(r.unknown.length, 7 + 2 * 10);
});

test("effect map: the committed map holds together and covers every effect", () => {
  const map = JSON.parse(readFileSync(OUT_JSON, "utf8"));
  assert.deepEqual(checkMap(map), []);
  for (const dir of ["toGp200", "toGp50"]) assert.equal(Object.keys(map[dir]).length, Object.keys(dir === "toGp200" ? map.gp50 : map.gp200).length);
  assert.equal(map.toGp200["0x0A000019"].moves[0].to, 1, "SUP Star's Volume: GP-50 position 0 is GP-200 position 1");
  assert.equal(stringify(map), readFileSync(OUT_JSON, "utf8"), "written one effect per line");
});

test("effect map: the committed files match what the tool makes from Valeton's files", (t) => {
  if (!existsSync(DEFAULT_GP200) || !existsSync(DEFAULT_GP50)) { t.skip("Valeton's GP-200 editor or Suite isn't installed here"); return; }
  const { json, md, problems } = makeFiles();
  assert.deepEqual(problems, []);
  assert.ok(json === readFileSync(OUT_JSON, "utf8") && md === readFileSync(OUT_MD, "utf8"), "gp50/effect-map.json or EFFECT_MAP.md is stale. Run: node tools/make-effect-map.js");
});
