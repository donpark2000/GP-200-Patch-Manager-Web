// The GP-50 read-only test page. Protocol and safety gate: protocol.js and
// device.js. gp50/?fake uses the fake pedal.

import { createZip } from "../src/core/zip.js";
import { identicalGroups, readAllSlots, slotFileName, slotRanges } from "./backup.js";
import { Gp50Reader } from "./device.js";
import { $, download, fileStamp, startPage } from "./page-common.js";
import { buildPrst, diffOffsets, toHex } from "./protocol.js";

const page = startPage({
  title: "GP-50 read-only test",
  buttons: ["read-settings", "read-slot", "read-names", "read-patch", "read-slot-patch", "read-all"],
  makeReader: (input, output, log) => new Gp50Reader(input, output, log),
  makeFake: (FakeGp50) => new FakeGp50(),
});
const { log, action } = page;

let names = null;
let lastPatch = null; // {name, slot, prst}
let lastAll = null; // readAllSlots result
let stopRequested = false;

$("save-patch").addEventListener("click", () => {
  const safe = lastPatch.name.replace(/[^\w .-]/g, "_").trim() || "unnamed";
  download(`gp50_${String(lastPatch.slot).padStart(2, "0")}_${safe}.prst`, lastPatch.prst, "application/octet-stream");
});

action("read-settings", async () => {
  const { firmware, records } = await page.reader.readSettings();
  for (const r of records) log.info(`Setting (${r.a},${r.b}): ${toHex(r.value)}`);
  return `Firmware ${firmware ?? "not found in the reply"}; ${records.length} settings (in the log).`;
});
action("read-slot", async () => `Selected slot: ${await page.reader.readSlot()} (counted from 0).`);
action("read-names", async () => {
  names = await page.reader.readNames();
  $("names").replaceChildren(...names.map((n) => Object.assign(document.createElement("li"), { textContent: n })));
  $("names").hidden = false;
  names.forEach((n, i) => log.info(`Name ${i}: ${JSON.stringify(n)}`));
  return `${names.length} names read.`;
});
action("read-patch", async () => {
  forgetPatch();
  // The patch reply has no name or slot in it. Read the slot on both sides,
  // so switching patches on the pedal meanwhile can't mislabel it.
  names = await page.reader.readNames();
  const slot = await page.reader.readSlot();
  const body = await page.reader.readPatchBody();
  const after = await page.reader.readSlot();
  if (after !== slot) throw new Error(`The pedal's patch changed from slot ${slot} to ${after} during the read; try again`);
  keepPatch({ name: names[slot], slot, prst: buildPrst(names[slot], body) });
  return `Slot ${slot} "${names[slot]}": ${body.length} bytes read.${await comparison()}`;
});
action("read-slot-patch", async () => {
  forgetPatch();
  const slot = $("slot").valueAsNumber;
  if (!Number.isInteger(slot) || slot < 0 || slot > 99) throw new Error("Slot must be a whole number from 0 to 99");
  const before = await page.reader.readSlot();
  const { name, prst } = await page.reader.readSlotPatch(slot);
  const after = await page.reader.readSlot();
  keepPatch({ name, slot, prst });
  const selected = before === after
    ? `The pedal stayed on slot ${before}${before === slot ? ", the slot read, so this doesn't show that it works for others" : ""}.`
    : `The pedal went from slot ${before} to ${after}.`;
  return `Slot ${slot} "${name}" read. ${selected}${await comparison()}`;
});

action("read-all", async () => {
  lastAll = null;
  $("save-zip").disabled = true;
  stopRequested = false;
  $("stop").disabled = false;
  $("progress").hidden = false;
  const t0 = performance.now();
  let r;
  try {
    r = await readAllSlots(page.reader, {
      log,
      isCancelled: () => stopRequested || !page.reader,
      onProgress: (done, total) => {
        $("progress").value = done / total;
        $("result").textContent = `Reading... ${done} of ${total}`;
      },
    });
  } finally {
    $("stop").disabled = true;
    $("progress").hidden = true;
  }
  lastAll = r;
  $("save-zip").disabled = r.entries.length === 0;
  for (const g of identicalGroups(r.entries)) log.info(`Identical patches: slots ${slotRanges(g)}`);
  const parts = [`${r.entries.length} of 100 slots read in ${((performance.now() - t0) / 1000).toFixed(1)} s, ${r.retries} retries.`];
  if (r.cancelled) parts.push("Stopped.");
  if (r.failed.length) parts.push(`FAILED: slots ${slotRanges(r.failed)}.`);
  if (r.wrongName.length) parts.push(`NAME DIFFERS from the pedal's list: slots ${slotRanges(r.wrongName)}.`);
  if (r.selectedAfter === null) parts.push("The pedal didn't say which slot it's on afterwards.");
  else parts.push(r.selectedBefore === r.selectedAfter ? `The pedal stayed on slot ${r.selectedBefore}.` : `The pedal went from slot ${r.selectedBefore} to ${r.selectedAfter}.`);
  const biggest = identicalGroups(r.entries).sort((a, b) => b.length - a.length)[0];
  if (biggest) parts.push(`Largest set of identical patches: slots ${slotRanges(biggest)}.`);
  return parts.join(" ");
});
$("stop").addEventListener("click", () => {
  stopRequested = true;
  $("stop").disabled = true;
});
$("save-zip").addEventListener("click", () => {
  const complete = lastAll.entries.length === 100 && !lastAll.wrongName.length;
  const zip = createZip(lastAll.entries.map((e) => ({ name: slotFileName(e.slot, e.name), data: e.prst })));
  download(`gp50_${complete ? "all" : "INCOMPLETE"}_${fileStamp()}.zip`, zip, "application/zip");
});

function forgetPatch() {
  lastPatch = null;
  $("save-patch").disabled = true;
}

function keepPatch(patch) {
  lastPatch = patch;
  $("save-patch").disabled = false;
  log.info(`Patch as .prst: ${toHex(patch.prst)}`);
}

async function comparison() {
  const file = $("compare").files[0];
  if (!file) return "";
  const diff = diffOffsets(lastPatch.prst, new Uint8Array(await file.arrayBuffer()));
  if (!diff.length) return ` Identical to ${file.name}.`;
  return ` DIFFERENT from ${file.name}: ${diff.length} bytes, at ${diff.slice(0, 20).map((i) => `0x${i.toString(16)}`).join(", ")}${diff.length > 20 ? ", ..." : ""}.`;
}
