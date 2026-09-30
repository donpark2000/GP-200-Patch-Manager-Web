// End-to-end export against the fake pedal: read, build, package, warn.

import assert from "node:assert/strict";
import { test } from "node:test";
import { GP200 } from "../src/core/device.js";
import { exportWarnings, packageExport, readSlots, zipFileName } from "../src/core/export.js";
import { Logger } from "../src/core/log.js";
import { exportPrst } from "../src/core/prst.js";
import { skeletonBytes } from "../src/core/skeleton.js";
import { parseSlotRange } from "../src/core/slots.js";
import { readZip } from "../src/core/unzip.js";
import { baseDump, dumpWithName, fixtureBytes } from "./helpers/fixtures.js";
import { FakePedal } from "./helpers/fake-pedal.js";

function setup(pedalOpts = {}) {
  const pedal = new FakePedal({ defaultDump: baseDump(), ...pedalOpts });
  const log = new Logger();
  const dev = new GP200({ input: pedal.input, output: pedal.output, log, timeoutMs: 50 });
  return { pedal, log, dev };
}

test("zip file names match the CLI's", () => {
  assert.equal(zipFileName(Array.from({ length: 256 }, (_, i) => i)), "gp200_all_patches.zip");
  assert.equal(zipFileName(parseSlotRange("34A", "36D")), "gp200_34A_to_36D.zip");
});

test("export a range: zip with CLI-style names and normalized contents", async () => {
  const glitchy = dumpWithName("Blue Sparkle");
  glitchy[0x9f - 0x28] = 0xb7; // the dead-byte read noise the CLI saw
  const { dev, log } = setup({ dumps: new Map([[1, dumpWithName("Clean")], [2, glitchy]]) });
  const slots = parseSlotRange("1A", "1C");
  const progress = [];
  const result = await readSlots(dev, slots, { skeleton: skeletonBytes(), log, onProgress: (p) => progress.push(p.done) });
  assert.deepEqual(progress, [1, 2, 3]);

  const pkg = packageExport(slots, result);
  assert.equal(pkg.fileName, "gp200_1A_to_1C.zip");
  const zip = await readZip(pkg.bytes);
  assert.deepEqual([...zip.keys()], ["1A_It's GP-200.prst", "1B_Clean.prst", "1C_Blue Sparkle.prst"]);
  const c = zip.get("1C_Blue Sparkle.prst");
  assert.equal(c[0x9f], 0, "dead byte is normalized to 0x00");
  assert.deepEqual(c, exportPrst(dumpWithName("Blue Sparkle"), skeletonBytes()));
  assert.ok(log.lines.some((l) => l.includes("First read (1A): 7 chunks")));
  assert.ok(log.lines.some((l) => l.includes("Read 3 of 3 slots")));
});

test("export one slot: a bare .prst, not a zip", async () => {
  const { dev, log } = setup({ dumps: new Map([[133, dumpWithName("Solo")]]) });
  const slots = [133];
  const pkg = packageExport(slots, await readSlots(dev, slots, { skeleton: skeletonBytes(), log }));
  assert.equal(pkg.fileName, "34B_Solo.prst");
  assert.equal(pkg.bytes.length, 1224);
});

test("export: an unreadable slot is skipped and the gap is warned about", async () => {
  const { dev, log } = setup({ faults: (slot) => (slot === 1 ? [] : undefined) });
  const slots = [0, 1, 2];
  const result = await readSlots(dev, slots, { skeleton: skeletonBytes(), log });
  assert.deepEqual(result.skipped, ["1B"]);
  assert.equal((await readZip(packageExport(slots, result).bytes)).size, 2);
  assert.match(exportWarnings(result).join(), /1B\. Restoring a zip fills slots one after another/);
  assert.ok(log.lines.some((l) => l.includes("ERROR") && l.includes("Error reading 1B - skipped")));
});

test("export: User-IR / NAM references produce the warning", async () => {
  const dump = fixtureBytes("golden/ir_nam.dump.bin");
  const { dev, log } = setup({ dumps: new Map([[40, dump]]) });
  const result = await readSlots(dev, [40, 41], { skeleton: skeletonBytes(), log });
  const w = exportWarnings(result).join();
  assert.match(w, /1 patch\(es\) reference 3 User-IR\/SnapTone/);
  assert.match(w, /11A: User-IR slot 3, SnapTone \(NAM\) slot 1 \(amp\), SnapTone \(NAM\) slot 2 \(dist\)/);
});

test("export: cancelling stops before the next slot", async () => {
  const { dev, log } = setup();
  let n = 0;
  const result = await readSlots(dev, [0, 1, 2, 3], {
    skeleton: skeletonBytes(), log, onProgress: () => n++, isCancelled: () => n >= 2,
  });
  assert.equal(result.entries.length, 2);
  assert.equal(result.cancelled, true);
});

test("export: nothing read means nothing to package", async () => {
  const { dev, log } = setup({ faults: () => [] });
  const result = await readSlots(dev, [0], { skeleton: skeletonBytes(), log });
  assert.equal(packageExport([0], result), null);
});
