// The GP-50 write test page (steps: DEV_JOURNAL.md, 2026-11-22). The only page
// that can write to a GP-50; its gate is write-protocol.js.
// gp50/write.html?fake uses the fake pedal.

import { readZip } from "../src/core/unzip.js";
import { createZip } from "../src/core/zip.js";
import { slotFileName, slotRanges } from "./backup.js";
import { $, download, fileStamp, startPage } from "./page-common.js";
import { describeDiff } from "./restore.js";
import { checkAll, expectedAfter, parseReference, runStage, STAGES } from "./write-steps.js";
import { Gp50Writer } from "./writer.js";

const WRITE_BUTTONS = { "write-first": "first", "write-copy": "copy", "write-reference": "reference" };

const page = startPage({
  title: "GP-50 write test",
  buttons: ["check", ...Object.keys(WRITE_BUTTONS)],
  makeReader: (input, output, log) => {
    forgetCheck();
    return new Gp50Writer(input, output, log);
  },
  makeFake: (FakeGp50) => (window.fakePedal = new FakeGp50({ writable: true })),
  whyNot,
});
const { log, action } = page;

let reference = null; // the patch of each slot, 0-99
let checked = null; // the last check since connecting or writing: {pass, complete}
let lastRead = null; // checkAll's result
let stopRequested = false;
const touched = new Set(); // slots this page has written

function whyNot(id) {
  if (!reference) return "Choose the reference zip first (section 2).";
  if (id === "check") return null;
  if (page.reader.halted) return "Writing stopped on a problem: press Connect again first.";
  if (!checked) return "Needs a check of all 100 (section 3) since connecting and since the last write.";
  // Putting things back must work from any state, e.g. a copy that stopped
  // partway; the slots themselves are checked before each write.
  if (id === "write-reference") return checked.complete ? null : "The last check didn't read all 100.";
  return checked.pass ? null : "The last check didn't match.";
}

function forgetCheck() {
  checked = null;
}

// The box is emptied once read, so choosing the same file again counts, and
// the name is shown next to it. A file the browser put back after a reload
// is read at once (journal 2026-11-22: the page looked hung).
async function chooseReference() {
  const file = $("reference").files[0];
  if (!file) return;
  reference = null;
  forgetCheck();
  try {
    reference = parseReference(await readZip(await file.arrayBuffer()));
    $("ref-status").textContent = `${file.name}: 100 patches, every CRC good.`;
    log.info(`Reference: ${file.name}, 100 patches, every CRC good`);
  } catch (err) {
    $("ref-status").textContent = `Can't use ${file.name}: ${err.message}`;
    log.error(`Reference ${file.name}: ${err.message}`);
  }
  $("reference").value = "";
  page.refresh();
}
$("reference").addEventListener("change", chooseReference);
page.refresh();
chooseReference();

action("check", () => check($("expected").value));
for (const [id, stage] of Object.entries(WRITE_BUTTONS)) action(id, () => write(stage));

$("stop").addEventListener("click", () => {
  stopRequested = true;
  $("stop").disabled = true;
});
$("save-zip").addEventListener("click", () => {
  const complete = lastRead.entries.length === 100 && !lastRead.wrongName.length;
  const zip = createZip(lastRead.entries.map((e) => ({ name: slotFileName(e.slot, e.name), data: e.prst })));
  download(`gp50_${complete ? "all" : "INCOMPLETE"}_${fileStamp()}.zip`, zip, "application/zip");
});

async function check(stage) {
  forgetCheck();
  lastRead = null;
  $("save-zip").disabled = true;
  const reader = page.reader;
  log.info(`Check: the pedal should hold ${STAGES[stage].label}`);
  const r = await withProgress("Reading", (opts) => checkAll(reader, expectedAfter(stage, reference), opts), reader);
  lastRead = r;
  $("save-zip").disabled = !r.entries.length;
  if (page.reader === reader) checked = { pass: r.pass, complete: r.compared === 100 };
  const parts = [`Check "${STAGES[stage].label}": ${r.pass ? "MATCH" : "DIFFERENT"}. ${r.compared} of 100 slots compared, ${r.compared - r.differing.length} identical, ${r.retries} retries.`];
  if (r.cancelled) parts.push("Stopped.");
  if (r.failed.length) parts.push(`COULDN'T READ: slots ${slotRanges(r.failed)}.`);
  if (r.wrongName.length) parts.push(`NAME DIFFERS from the pedal's list: slots ${slotRanges(r.wrongName)}.`);
  if (r.differing.length) parts.push(`DIFFER: slots ${slotRanges(r.differing.map((d) => d.slot))} (details in the log).`);
  for (const d of r.differing) log.warn(`Slot ${d.slot} "${d.name}" differs: ${describeDiff(d.offsets)}`);
  parts.push(selected(r));
  return parts.join(" ");
}

async function write(stage) {
  const { label, map } = STAGES[stage];
  const slots = slotRanges(map.map(([target]) => target));
  const what = map.length === 1 ? `one patch, to slot ${slots}` : `${map.length} patches, to slots ${slots}`;
  if (!confirm(`Write ${what}, on the GP-50?\n\nAfterwards: ${label}.\n\nOther slots are never written. Don't touch the pedal until it's done.`)) {
    log.info(`Write to ${slots} cancelled at the confirmation; nothing written`);
    return "Cancelled; nothing written.";
  }
  const writer = page.reader;
  forgetCheck(); // the next write needs its own check
  $("expected").value = stage;
  const t0 = performance.now();
  const r = await withProgress("Writing", (opts) => runStage(writer, stage, reference, { ...opts, touched, confirmed: true }), writer);
  const seconds = ((performance.now() - t0) / 1000).toFixed(1);
  const parts = [`${r.problem ? "STOPPED ON A PROBLEM" : r.cancelled ? "Stopped" : "Done"}: ${r.verified.length} of ${r.total} patches written and read back identical, ${seconds} s.`];
  if (r.problem) parts.push(`${r.problem}.`);
  const unsure = r.written.filter((s) => !r.verified.includes(s));
  if (unsure.length) parts.push(`Slot ${slotRanges(unsure)} may have changed.`);
  else if (!r.written.length) parts.push("Nothing was written.");
  parts.push(selected(r));
  if (!r.problem) parts.push("Now check all 100.");
  return parts.join(" ");
}

function selected({ selectedBefore, selectedAfter }) {
  if (selectedBefore === null) return "";
  if (selectedAfter === null) return "The pedal didn't say which slot it's on afterwards.";
  return selectedBefore === selectedAfter ? `The pedal stayed on slot ${selectedBefore}.` : `The pedal went from slot ${selectedBefore} to ${selectedAfter}.`;
}

async function withProgress(verb, run, connection) {
  stopRequested = false;
  $("stop").disabled = false;
  $("progress").value = 0;
  $("progress").hidden = false;
  try {
    return await run({
      log,
      isCancelled: () => stopRequested || page.reader !== connection,
      onProgress: (done, total) => {
        $("progress").value = done / total;
        $("result").textContent = `${verb}... ${done} of ${total}`;
      },
    });
  } finally {
    $("stop").disabled = true;
    $("progress").hidden = true;
  }
}
