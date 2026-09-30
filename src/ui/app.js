// Bare test page (DESIGN.md "Order of work", step 2): connect, export all or
// a range, and a log that can be saved. Replaced by the designed UI later;
// all protocol logic lives in src/core/.

import { findGp200Ports, GP200 } from "../core/device.js";
import { exportWarnings, packageExport, readSlots } from "../core/export.js";
import { Logger } from "../core/log.js";
import { skeletonBytes } from "../core/skeleton.js";
import { slotsBetween, slotToLabel } from "../core/slots.js";
import { VERSION } from "../version.js";

const $ = (id) => document.getElementById(id);
const ui = {
  connect: $("connect"), status: $("status"), picker: $("port-picker"),
  inPort: $("in-port"), outPort: $("out-port"),
  from: $("from"), to: $("to"), export: $("export"), cancel: $("cancel"),
  progress: $("progress"), progressText: $("progress-text"), warnings: $("warnings"),
  debug: $("debug"), saveLog: $("save-log"), clearLog: $("clear-log"), log: $("log"),
  unsupported: $("unsupported"), version: $("version"),
};

const log = new Logger({ onLine: appendLogLine });
let midi = null;
let device = null;
let cancelRequested = false;

ui.version.textContent = `Version ${VERSION}.`;
log.info(`GP-200 Patch Manager Web, version ${VERSION}`);

if (!navigator.requestMIDIAccess) {
  showUnsupported("This browser doesn't support Web MIDI. Please use Chrome or Edge on a computer.");
} else if (!window.isSecureContext) {
  showUnsupported("Web MIDI needs a secure page (https:// or localhost). Open the hosted version instead.");
}

ui.connect.addEventListener("click", onConnect);
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
    ui.export.disabled = false;
  } catch (e) {
    device = null;
    ui.export.disabled = true;
    const msg = e?.name === "SecurityError" || e?.name === "NotAllowedError"
      ? "MIDI access was blocked. Allow it from the icon in the address bar, then try again."
      : `Couldn't connect: ${e?.message ?? e}`;
    setStatus(msg);
    log.error(msg);
  } finally {
    ui.connect.disabled = false;
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
    ui.export.disabled = true;
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
  setBusy(true);
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

function setBusy(busy) {
  ui.export.disabled = busy || !device;
  ui.connect.disabled = busy;
  ui.cancel.hidden = !busy;
  ui.cancel.disabled = false;
  ui.progress.hidden = !busy;
}

function setStatus(text, ok = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle("ok", ok);
}

function showWarnings(list, kind = "warn") {
  ui.warnings.replaceChildren(...list.map((w) => {
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
