// Bare test page (DESIGN.md "Order of work", step 2): connect, export all or
// a range, restore (test build), and a log that can be saved. Replaced by
// the designed UI later; all protocol logic lives in src/core/.

import { findGp200Ports, GP200 } from "../core/device.js";
import { exportWarnings, packageExport, readSlots } from "../core/export.js";
import { Logger } from "../core/log.js";
import { skeletonBytes } from "../core/skeleton.js";
import { labelToSlot, slotsBetween, slotToLabel } from "../core/slots.js";
import { expandSources, orderEntries, planUpload, planWarnings, writeSlots } from "../core/upload.js";
import { createZip } from "../core/zip.js";
import { VERSION } from "../version.js";

const $ = (id) => document.getElementById(id);
const ui = {
  connect: $("connect"), status: $("status"), picker: $("port-picker"),
  inPort: $("in-port"), outPort: $("out-port"),
  from: $("from"), to: $("to"), export: $("export"), cancel: $("cancel"),
  progress: $("progress"), progressText: $("progress-text"), warnings: $("warnings"),
  debug: $("debug"), saveLog: $("save-log"), clearLog: $("clear-log"), log: $("log"),
  unsupported: $("unsupported"), version: $("version"),
  restoreStart: $("restore-start"), restoreFiles: $("restore-files"), restorePlan: $("restore-plan"),
  restoreWarnings: $("restore-warnings"), restoreWrite: $("restore-write"), restoreStop: $("restore-stop"),
  restoreStatus: $("restore-status"), restoreFailed: $("restore-failed"),
};

const log = new Logger({ onLine: appendLogLine });
let midi = null;
let device = null;
let cancelRequested = false;
let busy = false;
let plan = null; // the current restore plan, shown before anything is written
let failedReadbacks = [];
const knownNames = new Map(); // slot -> patch name, from this session's reads and writes

ui.version.textContent = `Version ${VERSION}.`;
log.info(`GP-200 Patch Manager Web, version ${VERSION}`);

if (!navigator.requestMIDIAccess) {
  showUnsupported("This browser doesn't support Web MIDI. Please use Chrome or Edge on a computer.");
} else if (!window.isSecureContext) {
  showUnsupported("Web MIDI needs a secure page (https:// or localhost). Open the hosted version instead.");
}

ui.connect.addEventListener("click", onConnect);
ui.restoreStart.addEventListener("change", rebuildPlan);
ui.restoreFiles.addEventListener("change", rebuildPlan);
ui.restoreWrite.addEventListener("click", onRestore);
ui.restoreStop.addEventListener("click", () => {
  cancelRequested = true;
  ui.restoreStop.disabled = true;
});
ui.restoreFailed.addEventListener("click", () => {
  const zip = createZip(failedReadbacks.map((r) => ({ name: `failed_verify_${r.label}.prst`, data: r.roundtrip })));
  download("gp200_failed_readbacks.zip", zip, "application/zip");
});
ui.export.addEventListener("click", onExport);
ui.cancel.addEventListener("click", () => {
  cancelRequested = true;
  ui.cancel.disabled = true;
});
ui.debug.addEventListener("change", () => {
  log.debugEnabled = ui.debug.checked;
  log.info(`Debug logging ${ui.debug.checked ? "on" : "off"}`);
});
ui.saveLog.addEventListener("click", () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  download(`gp200_web_${stamp}.log`, new TextEncoder().encode(log.text(environmentInfo())), "text/plain");
});
ui.clearLog.addEventListener("click", () => {
  log.clear();
  ui.log.textContent = "";
});

async function onConnect() {
  ui.connect.disabled = true;
  try {
    if (!midi) {
      log.info("Requesting MIDI access (with SysEx)...");
      midi = await navigator.requestMIDIAccess({ sysex: true });
      midi.addEventListener("statechange", onPortStateChange);
      fillPortPickers();
    }
    const input = midi.inputs.get(ui.inPort.value);
    const output = midi.outputs.get(ui.outPort.value);
    if (!input || !output) {
      ui.picker.hidden = false;
      setStatus("Pick the GP-200's input and output, then press Connect again.");
      log.warn("Couldn't pick the GP-200's ports automatically; choose them from the lists.");
      return;
    }
    if (device) device.close();
    log.info(`Connecting: in="${input.name}" out="${output.name}"`);
    device = new GP200({ input, output, log });
    await device.connect();
    setStatus(`Connected to ${input.name}`, true);
  } catch (e) {
    device = null;
    const msg = e?.name === "SecurityError" || e?.name === "NotAllowedError"
      ? "MIDI access was blocked. Allow it from the icon in the address bar, then try again."
      : `Couldn't connect: ${e?.message ?? e}`;
    setStatus(msg);
    log.error(msg);
  } finally {
    ui.connect.disabled = false;
    refreshButtons();
  }
}

function fillPortPickers() {
  const fill = (select, ports) => {
    const previous = select.value;
    select.replaceChildren(...[...ports.values()].map((p) => new Option(p.name, p.id)));
    const matches = findGp200Ports(ports.values());
    if (ports.has(previous)) select.value = previous; // keep a manual choice
    else select.value = matches.length === 1 ? matches[0].id : "";
    return matches.length;
  };
  const nIn = fill(ui.inPort, midi.inputs);
  const nOut = fill(ui.outPort, midi.outputs);
  log.info(`MIDI ports: ${midi.inputs.size} input(s), ${midi.outputs.size} output(s); ` +
    `GP-200 matches: ${nIn} input(s), ${nOut} output(s)`);
  ui.picker.hidden = nIn === 1 && nOut === 1;
}

function onPortStateChange(e) {
  const p = e.port;
  log.info(`MIDI port ${p.type} "${p.name}" is now ${p.state}/${p.connection}`);
  if (p.state === "disconnected" && device && (p.id === device.input.id || p.id === device.output.id)) {
    device.close();
    device = null;
    refreshButtons();
    setStatus("Pedal disconnected. Plug it back in and press Connect.");
  }
  if (!device) fillPortPickers();
}

async function onExport() {
  let slots;
  try {
    slots = slotsBetween(ui.from.value, ui.to.value);
  } catch (e) {
    showWarnings([e.message], "error");
    return;
  }
  ui.warnings.replaceChildren();
  cancelRequested = false;
  setBusy("export");
  ui.progress.max = slots.length;
  ui.progress.value = 0;
  log.info(`Exporting ${slots.length} slot(s): ${slotToLabel(slots[0])} to ${slotToLabel(slots.at(-1))}`);
  try {
    const result = await readSlots(device, slots, {
      skeleton: skeletonBytes(),
      log,
      isCancelled: () => cancelRequested,
      onProgress: ({ done, total, label, name }) => {
        ui.progress.value = done;
        ui.progressText.textContent = `${done} / ${total}: ${label} ${name ?? "(skipped)"}`;
      },
    });
    for (const e of result.entries) knownNames.set(e.slot, e.name);
    renderPlan();
    const pkg = result.cancelled ? null : packageExport(slots, result);
    if (pkg) {
      download(pkg.fileName, pkg.bytes, pkg.fileName.endsWith(".zip") ? "application/zip" : "application/octet-stream");
      log.info(`Saved ${pkg.fileName} (${result.entries.length} patch(es))`);
      ui.progressText.textContent = `Done: saved ${pkg.fileName}`;
    } else {
      ui.progressText.textContent = result.cancelled ? "Cancelled; nothing saved." : "Nothing could be read; nothing saved.";
    }
    const warnings = exportWarnings(result);
    for (const w of warnings) log.warn(w);
    showWarnings(warnings);
  } catch (e) {
    log.error(`Export failed: ${e?.stack ?? e}`);
    showWarnings([`Export failed: ${e?.message ?? e}`], "error");
  } finally {
    setBusy(false);
  }
}

/** @param {false|"export"|"restore"} what */
function setBusy(what) {
  busy = Boolean(what);
  ui.connect.disabled = busy;
  ui.cancel.hidden = what !== "export";
  ui.cancel.disabled = false;
  ui.restoreStop.hidden = what !== "restore";
  ui.restoreStop.disabled = false;
  ui.progress.hidden = what !== "export";
  refreshButtons();
}

function refreshButtons() {
  ui.export.disabled = busy || !device;
  ui.restoreWrite.disabled = busy || !device || !plan?.items.length;
  ui.restoreStart.disabled = busy;
  ui.restoreFiles.disabled = busy;
}

// ---- Restore (test build) ---------------------------------------------------

async function rebuildPlan() {
  plan = null;
  ui.restoreWarnings.replaceChildren();
  ui.restoreStatus.textContent = "";
  const files = [...ui.restoreFiles.files];
  const startText = ui.restoreStart.value.trim();
  try {
    if (!files.length) return;
    if (!startText) {
      ui.restoreStatus.textContent = "Enter a starting slot, e.g. 64A.";
      return;
    }
    const start = labelToSlot(startText);
    const picked = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    const { entries, notes } = await expandSources(picked);
    const { ordered, orderedBy } = orderEntries(entries);
    plan = planUpload(ordered, start);
    const warnings = [...notes, ...planWarnings(plan)];
    showList(ui.restoreWarnings, warnings);
    const n = plan.items.length;
    ui.restoreStatus.textContent = n
      ? `${n} patch(es) to ${plan.items[0].label}-${plan.items.at(-1).label}, in order of ${orderedBy}.`
      : "Nothing to write.";
    log.info(`Restore plan: ${n} patch(es) from ${files.map((f) => f.name).join(", ")}, ordered by ${orderedBy}`);
    for (const w of warnings) log.warn(w);
  } catch (e) {
    plan = null;
    showList(ui.restoreWarnings, [e.message], "error");
  } finally {
    renderPlan();
    refreshButtons();
  }
}

function renderPlan(results = new Map()) {
  const body = ui.restorePlan.tBodies[0];
  ui.restorePlan.hidden = !plan?.items.length;
  if (!plan) return body.replaceChildren();
  body.replaceChildren(...plan.items.map((it) => {
    const tr = document.createElement("tr");
    const r = results.get(it.slot);
    const cells = [it.fileName, it.patchName, it.label, knownNames.get(it.slot) ?? "(not read yet)",
      r ? (r.ok ? "verified" : `NOT verified: ${r.reason}`) : ""];
    for (const text of cells) tr.append(Object.assign(document.createElement("td"), { textContent: text }));
    if (r) tr.lastChild.className = r.ok ? "ok" : "bad";
    return tr;
  }));
}

async function onRestore() {
  if (!plan?.items.length || !device) return;
  const n = plan.items.length;
  const range = `${plan.items[0].label}-${plan.items.at(-1).label}`;
  if (!confirm(`Write ${n} patch(es) to ${range} on the pedal?\n\n` +
    "This replaces what's in those slots now. Make sure you have a backup.")) {
    log.info("Restore cancelled at the confirmation prompt; nothing written");
    return;
  }
  cancelRequested = false;
  failedReadbacks = [];
  ui.restoreFailed.hidden = true;
  setBusy("restore");
  const results = new Map();
  log.info(`Restoring ${n} patch(es) to ${range}`);
  try {
    const out = await writeSlots(device, plan.items, {
      skeleton: skeletonBytes(),
      log,
      isCancelled: () => cancelRequested,
      onProgress: ({ done, total, label }) => {
        ui.restoreStatus.textContent = `${done} / ${total} written (${label})`;
      },
    });
    for (const r of out.results) {
      results.set(r.slot, r);
      if (r.deviceName !== null) knownNames.set(r.slot, r.deviceName);
    }
    failedReadbacks = out.failed.filter((r) => r.roundtrip);
    ui.restoreFailed.hidden = failedReadbacks.length === 0;
    ui.restoreStatus.textContent = `${out.results.length - out.failed.length} of ${n} verified` +
      (out.failed.length ? `, ${out.failed.length} NOT verified (see the log)` : "") +
      (out.cancelled ? "; stopped early" : "") + ".";
  } catch (e) {
    log.error(`Restore stopped: ${e?.stack ?? e}`);
    showList(ui.restoreWarnings, [`Restore stopped: ${e?.message ?? e}. Check the pedal, then export the affected slots to see what they hold.`], "error");
  } finally {
    setBusy(false);
    renderPlan(results);
  }
}

function setStatus(text, ok = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle("ok", ok);
}

function showWarnings(list, kind = "warn") {
  showList(ui.warnings, list, kind);
}

function showList(ul, list, kind = "warn") {
  ul.replaceChildren(...list.map((w) => {
    const li = document.createElement("li");
    li.textContent = w;
    if (kind === "error") li.className = "error";
    return li;
  }));
}

function showUnsupported(text) {
  ui.unsupported.textContent = text;
  ui.unsupported.hidden = false;
  ui.connect.disabled = true;
  log.error(text);
}

function appendLogLine(line) {
  const atBottom = ui.log.scrollTop + ui.log.clientHeight >= ui.log.scrollHeight - 4;
  ui.log.append(line + "\n");
  if (atBottom) ui.log.scrollTop = ui.log.scrollHeight;
}

function download(fileName, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Header for a saved log: enough to reproduce or support a user's run. */
function environmentInfo() {
  const lines = [
    "GP-200 Patch Manager Web -- log",
    `Version: ${VERSION}`,
    `Saved: ${new Date().toISOString()}`,
    `Page: ${location.href}`,
    `User agent: ${navigator.userAgent}`,
  ];
  const uad = navigator.userAgentData;
  if (uad) {
    lines.push(`Browser: ${uad.brands.map((b) => `${b.brand} ${b.version}`).join(", ")}; platform ${uad.platform}`);
  }
  if (midi) {
    lines.push(`MIDI access: sysex=${midi.sysexEnabled}`);
    for (const [kind, ports] of [["in", midi.inputs], ["out", midi.outputs]]) {
      for (const p of ports.values()) {
        lines.push(`  ${kind}: "${p.name}" manufacturer="${p.manufacturer}" version="${p.version}" ${p.state}/${p.connection}`);
      }
    }
  } else {
    lines.push("MIDI access: not requested yet");
  }
  lines.push(`Connected: ${device ? `in="${device.input.name}" out="${device.output.name}"` : "no"}`);
  return lines;
}
