// The GP-50 read-only test page. Protocol and safety gate: protocol.js and
// device.js. gp50/?fake uses the fake pedal.

import { Logger } from "../src/core/log.js";
import { Gp50Reader, isGp50Name } from "./device.js";
import { buildPrst, toHex } from "./protocol.js";

const $ = (id) => document.getElementById(id);
const readButtons = ["read-settings", "read-slot", "read-names", "read-patch"];
const log = new Logger({
  onLine: (line) => {
    $("log").textContent += `${line}\n`;
    $("log").scrollTop = $("log").scrollHeight;
  },
});
log.debugEnabled = true;

let access = null;
let reader = null;
let names = null;
let lastPatch = null; // {name, slot, prst}

log.info(`GP-50 read-only test. ${navigator.userAgent}`);

$("connect").addEventListener("click", connect);
$("debug").addEventListener("change", () => { log.debugEnabled = $("debug").checked; });
$("clear-log").addEventListener("click", () => {
  log.clear();
  $("log").textContent = "";
});
$("save-log").addEventListener("click", () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const header = ["GP-50 read-only test", `Saved: ${new Date().toISOString()}`, `Page: ${location.href}`, `Browser: ${navigator.userAgent}`, ...portLines()];
  download(`gp50_test_${stamp}.log`, log.text(header), "text/plain");
});
$("save-patch").addEventListener("click", () => {
  const safe = lastPatch.name.replace(/[^\w .-]/g, "_").trim() || "unnamed";
  download(`gp50_${String(lastPatch.slot).padStart(2, "0")}_${safe}.prst`, lastPatch.prst, "application/octet-stream");
});

action("read-settings", async () => {
  const { firmware, records } = await reader.readSettings();
  for (const r of records) log.info(`Setting (${r.a},${r.b}): ${toHex(r.value)}`);
  return `Firmware ${firmware ?? "not found in the reply"}; ${records.length} settings (in the log).`;
});
action("read-slot", async () => `Selected slot: ${await reader.readSlot()} (counted from 0).`);
action("read-names", async () => {
  names = await reader.readNames();
  $("names").replaceChildren(...names.map((n) => Object.assign(document.createElement("li"), { textContent: n })));
  $("names").hidden = false;
  names.forEach((n, i) => log.info(`Name ${i}: ${JSON.stringify(n)}`));
  return `${names.length} names read.`;
});
action("read-patch", async () => {
  // The patch reply has no name or slot in it. Read the slot on both sides,
  // so switching patches on the pedal meanwhile can't mislabel it.
  lastPatch = null;
  $("save-patch").disabled = true;
  names = await reader.readNames();
  const slot = await reader.readSlot();
  const body = await reader.readPatchBody();
  const after = await reader.readSlot();
  if (after !== slot) throw new Error(`The pedal's patch changed from slot ${slot} to ${after} during the read; try again`);
  lastPatch = { name: names[slot], slot, prst: buildPrst(names[slot], body) };
  $("save-patch").disabled = false;
  log.info(`Patch as .prst: ${toHex(lastPatch.prst)}`);
  return `Slot ${slot} "${names[slot]}": ${body.length} bytes read.`;
});

async function connect() {
  $("connect").disabled = true;
  try {
    if (new URLSearchParams(location.search).has("fake")) {
      const { FakeGp50 } = await import("./fake-gp50.js");
      const pedal = new FakeGp50();
      access ??= { inputs: new Map([["i", pedal.input]]), outputs: new Map([["o", pedal.output]]) };
    } else if (!navigator.requestMIDIAccess) {
      throw new Error("This browser has no Web MIDI; use Chrome or Edge on a computer");
    } else if (!access) {
      log.info("Requesting MIDI access (with SysEx)...");
      access = await navigator.requestMIDIAccess({ sysex: true });
      access.onstatechange = (e) => {
        log.info(`Port ${e.port.type} "${e.port.name}": ${e.port.state}, ${e.port.connection}`);
        if (reader && e.port.state === "disconnected" && (e.port === reader.input || e.port === reader.output)) {
          disconnect("The pedal was disconnected. Press Connect once it's back.");
        }
      };
    }
    portLines().forEach((l) => log.info(l));
    const input = choosePort("in-port", access.inputs);
    const output = choosePort("out-port", access.outputs);
    if (!input || !output) throw new Error("No GP-50 port chosen: pick an input and an output below, then Connect again");
    // Opening first shows "another program has it" as its own error.
    await input.open?.();
    await output.open?.();
    reader?.close();
    reader = new Gp50Reader(input, output, log);
    setReading(false);
    setStatus(`Ports open: in "${input.name}", out "${output.name}". Nothing sent yet.`);
    log.info("Ports open; nothing sent yet");
  } catch (err) {
    disconnect(`Couldn't connect: ${err.message}`);
    log.error(`Connect failed: ${err.name}: ${err.message}`);
  } finally {
    $("connect").disabled = false;
  }
}

function disconnect(message) {
  reader?.close();
  reader = null;
  for (const id of readButtons) $(id).disabled = true;
  setStatus(message);
}

/** Keeps the user's choice; otherwise picks the GP-50 if exactly one port is named so. */
function choosePort(id, ports) {
  const select = $(id);
  const before = select.value;
  const list = [...ports.entries()];
  select.replaceChildren(new Option("(choose)", ""), ...list.map(([key, p]) => new Option(p.name || "(no name)", key)));
  select.disabled = false;
  const gp50 = list.filter(([, p]) => isGp50Name(p.name));
  select.value = ports.has(before) ? before : gp50.length === 1 ? gp50[0][0] : "";
  return ports.get(select.value) ?? null;
}

function action(id, run) {
  $(id).addEventListener("click", async () => {
    setReading(true);
    $("result").textContent = "Reading...";
    try {
      $("result").textContent = await run();
      log.info($("result").textContent);
    } catch (err) {
      $("result").textContent = err.message;
      log.error(err.message);
    } finally {
      setReading(false);
    }
  });
}

function setReading(reading) {
  for (const id of readButtons) $(id).disabled = reading || !reader;
}

function setStatus(text) {
  $("status").textContent = text;
}

function portLines() {
  if (!access) return ["MIDI ports: not asked for yet"];
  const list = (kind, ports) => [...ports.values()].map((p) =>
    `MIDI ${kind}: "${p.name}" manufacturer "${p.manufacturer ?? ""}" version "${p.version ?? ""}" ${p.state ?? ""} ${p.connection ?? ""}`);
  const lines = [...list("input", access.inputs), ...list("output", access.outputs)];
  return lines.length ? lines : ["MIDI ports: none"];
}

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
