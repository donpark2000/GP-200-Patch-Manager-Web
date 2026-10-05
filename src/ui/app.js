// The designed UI (DESIGN.md, "Designed UI"): one page, screens switched by
// #home / #backup / #restore / #template / #help, over the patch list. Thin by
// design: plans, texts and checks come from src/core/ (Node-tested); this
// file reads the inputs, renders, and logs. The developer test page
// (test.html, src/ui/testpage.js) runs the same core.

import { CLI_WRITE_TIMING, findGp200Ports, GP200, WRITE_TIMING } from "../core/device.js";
import { exportWarnings, packageExport, readPatchList, readSlots } from "../core/export.js";
import { Logger } from "../core/log.js";
import { browserSummary, issueUrl } from "../core/report.js";
import {
  afterNames, backupSummary, clickRange, dragRange, parseRange, parseStart, restoreConfirmText, restoreSummary,
  screenAfterConnect, templateConfirmText, templateMarks, templateScreenSummary,
} from "../core/screens.js";
import { skeletonBytes } from "../core/skeleton.js";
import { slotToDisplayLabel, TOTAL_SLOTS } from "../core/slots.js";
import { isEmptyPatchName, planTemplate, recheckTemplate, templateSummary, templateWarnings } from "../core/template.js";
import { expandSources, orderEntries, planUpload, planWarnings, writeSlots } from "../core/upload.js";
import { createZip } from "../core/zip.js";
import { VERSION } from "../version.js";

const $ = (id) => document.getElementById(id);
const SCREENS = ["home", "backup", "restore", "template", "help"]; // home: the welcome panel
const PARAMS = new URLSearchParams(location.search);
const DEV = PARAMS.has("dev");
const FAKE = DEV && PARAMS.has("fake"); // the test suite's fake pedal, localhost only (fake-dev.js)
const lab = slotToDisplayLabel;
const NOT_CONNECTED = "Connect the pedal first"; // rarely seen: these screens show the welcome panel until connected
const PEDAL_SCREENS = ["backup", "restore", "template"];

const log = new Logger({ onLine: appendLogLine });

const state = {
  screen: "home",
  midi: null,
  device: null,
  wasConnected: false, // connected earlier this visit (screenAfterConnect)
  // names[slot]: undefined = not read yet, null = couldn't be read, else the patch name
  names: new Array(TOTAL_SLOTS).fill(undefined),
  busy: false, // false | "connect" | "backup" | "restore" | "template"
  cancelRequested: false,
  failedSlots: new Set(), // slots whose last write wasn't verified; marked in the list
  failedReadbacks: [],
  clickNext: { backup: "from", template: "from" },
  drag: null, // { anchor, moved } while the mouse is held down on the list
  dragEnded: false, // a drag just ended: ignore the click the browser may send
  restore: { picked: null, error: null, showAfter: false, label: "" },
  template: { file: null, error: null, showAfter: false },
  hiddenAt: null,
  lastVisibleAgainAt: -Infinity,
  wakeLock: null,
  timer: null,
};

const nameOf = (slot) => state.names[slot] ?? null;

// ---- Start-up ---------------------------------------------------------------

$("version").textContent = `Version ${VERSION}`;
log.info(`GP-200 Patch Manager Web (designed UI), version ${VERSION}`);
buildList();

if (FAKE) {
  // no browser check: the fake pedal needs no Web MIDI
} else if (!navigator.requestMIDIAccess) {
  showUnsupported("This browser can't reach the pedal: it has no Web MIDI. Please use Chrome or Edge on a computer (see Help).");
} else if (!window.isSecureContext) {
  showUnsupported("Web MIDI needs a secure page (https:// or localhost). Open the hosted version instead.");
}
if (DEV) {
  $("dev-log").hidden = false;
  $("pacing-row").hidden = false;
  log.info("Developer tools shown (?dev in the address)");
}

addEventListener("hashchange", () => show(location.hash.slice(1)));
document.addEventListener("visibilitychange", onVisibilityChange);
$("connect").addEventListener("click", onConnect);

for (const id of ["from", "to", "start", "tfrom", "tto"]) {
  $(id).addEventListener("input", () => {
    if (id === "from") state.clickNext.backup = "from";
    if (id === "tfrom") state.clickNext.template = "from";
    paint();
  });
}
$("go-backup").addEventListener("click", onBackup);

$("pick").addEventListener("click", () => $("files").click());
$("files").addEventListener("change", onRestoreFiles);
$("show-now").addEventListener("click", () => setShowAfter("restore", false));
$("show-after").addEventListener("click", () => setShowAfter("restore", true));
$("go-restore").addEventListener("click", onRestore);

$("tpick").addEventListener("click", () => $("tfile").click());
$("tfile").addEventListener("change", onTemplateFile);
for (const id of ["tmode-empty", "tmode-all"]) $(id).addEventListener("change", paint);
$("tshow-now").addEventListener("click", () => setShowAfter("template", false));
$("tshow-after").addEventListener("click", () => setShowAfter("template", true));
$("go-template").addEventListener("click", onTemplate);

$("stop").addEventListener("click", () => {
  state.cancelRequested = true;
  $("stop").disabled = true;
  log.info("Stop requested: finishing the patch being written");
});
$("save-log").addEventListener("click", saveLog);
$("report").addEventListener("click", onReport);
$("dev-save-log").addEventListener("click", saveLog);
$("clear-log").addEventListener("click", () => {
  log.clear();
  $("log").textContent = "";
});
$("debug").addEventListener("change", () => {
  log.debugEnabled = $("debug").checked;
  log.info(`Debug logging ${$("debug").checked ? "on" : "off"}`);
});
$("failed-readbacks").addEventListener("click", () => {
  const zip = createZip(state.failedReadbacks.map((r) => ({ name: `failed_verify_${r.label}.prst`, data: r.roundtrip })));
  download("gp200_failed_readbacks.zip", zip, "application/zip");
});

show(location.hash.slice(1));

// ---- Screens ----------------------------------------------------------------

function show(name) {
  if (!SCREENS.includes(name)) name = "home";
  if (name !== state.screen) log.info(`Screen: ${name}`);
  state.screen = name;
  // The home page (the title links to it) is the welcome panel. Until the
  // pedal is connected, the pedal screens show it too, with its one
  // control, Connect (developer, 2026-10-02).
  const welcome = name === "home" || (PEDAL_SCREENS.includes(name) && !state.device);
  $("scr-connect").hidden = !welcome;
  for (const n of SCREENS) {
    if (n === "home") continue;
    $(`scr-${n}`).hidden = n !== name || welcome;
    const a = $(`nav-${n}`);
    a.classList.toggle("on", n === name);
    if (n === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  const noList = name === "help" || welcome;
  $("listbox").hidden = noList;
  $("prog").hidden = noList;
  paint();
}

function setShowAfter(which, after) {
  state[which].showAfter = after;
  const [now, aft] = which === "restore" ? ["show-now", "show-after"] : ["tshow-now", "tshow-after"];
  $(now).classList.toggle("on", !after);
  $(aft).classList.toggle("on", after);
  $(now).setAttribute("aria-pressed", String(!after));
  $(aft).setAttribute("aria-pressed", String(after));
  paint();
}

// ---- The patch list ---------------------------------------------------------

function buildList() {
  const list = $("list");
  for (let s = 0; s < TOTAL_SLOTS; s++) {
    const d = document.createElement("div");
    d.className = "cell";
    d.dataset.s = String(s);
    const l = document.createElement("span");
    l.className = "lab";
    l.textContent = lab(s);
    const n = document.createElement("span");
    n.className = "nm";
    d.append(l, n);
    list.append(d);
  }
  list.addEventListener("click", onListClick);
  list.addEventListener("pointerdown", onListPointerDown);
  addEventListener("pointermove", onListPointerMove);
  addEventListener("pointerup", onListPointerUp);
  addEventListener("pointercancel", onListPointerUp);
}

/** The From/To boxes the list fills on this screen, or null (Restore, Help). */
function rangeBoxes() {
  if (state.screen === "backup") return ["from", "to"];
  if (state.screen === "template") return ["tfrom", "tto"];
  return null;
}

const cellSlot = (el) => {
  const c = el?.closest?.(".cell");
  return c ? Number(c.dataset.s) : undefined;
};

function onListClick(e) {
  if (state.dragEnded) { state.dragEnded = false; return; } // the drag already set the range
  const s = cellSlot(e.target);
  if (s === undefined || state.busy) return;
  const boxes = rangeBoxes();
  if (state.screen === "restore") {
    $("start").value = lab(s);
  } else if (boxes) {
    const r = clickRange(parseStart($(boxes[0]).value).slot, state.clickNext[state.screen], s);
    $(boxes[0]).value = lab(r.from);
    $(boxes[1]).value = lab(r.to);
    state.clickNext[state.screen] = r.next;
  }
  paint();
}

// Dragging across the list sets a From/To range (developer, 2026-10-05). A
// press and release on one patch stays a click; only reaching a second
// patch turns it into a drag.
function onListPointerDown(e) {
  state.dragEnded = false;
  const s = cellSlot(e.target);
  if (s === undefined || state.busy || e.button !== 0 || !rangeBoxes()) return;
  state.drag = { anchor: s, moved: false };
}

function onListPointerMove(e) {
  const d = state.drag;
  if (!d) return;
  const s = cellSlot(document.elementFromPoint(e.clientX, e.clientY));
  if (s === undefined || (!d.moved && s === d.anchor)) return;
  const boxes = rangeBoxes();
  if (!boxes) return;
  d.moved = true;
  const r = dragRange(d.anchor, s);
  if ($(boxes[0]).value === lab(r.from) && $(boxes[1]).value === lab(r.to)) return; // nothing new to paint
  $(boxes[0]).value = lab(r.from);
  $(boxes[1]).value = lab(r.to);
  paint();
}

function onListPointerUp() {
  const d = state.drag;
  state.drag = null;
  if (!d?.moved) return;
  const boxes = rangeBoxes();
  if (boxes) {
    state.clickNext[state.screen] = "from";
    log.info(`Range dragged on ${state.screen}: ${$(boxes[0]).value} to ${$(boxes[1]).value}`);
  }
  state.dragEnded = true;
}

/** Paint the list as the pedal is now, then let the screen add its range. */
function paintList(decorate) {
  const cells = $("list").children;
  $("list").classList.toggle("busy", Boolean(state.busy));
  for (let s = 0; s < TOTAL_SLOTS; s++) {
    const c = cells[s];
    const n = state.names[s];
    c.className = "cell" + (s % 4 === 0 && s % 32 !== 0 ? " bankstart" : "") +
      (n === undefined || isEmptyPatchName(n) ? " def" : "") + (n === null ? " unread" : "") +
      (state.failedSlots.has(s) ? " bad" : "");
    c.querySelector(".nm").textContent = n === undefined ? "" : n === null ? "(couldn't read)" : n;
    c.title = n === undefined ? lab(s) : `${lab(s)} ${n ?? "(couldn't read)"}` +
      (state.failedSlots.has(s) ? " (last write NOT verified)" : "");
  }
  decorate?.(cells);
}

function markRange(cells, slots, kind) {
  slots.forEach((s, i) => {
    cells[s].classList.add(kind);
    if (kind === "over") cells[s].classList.remove("def"); // shown as about to be replaced
    if (i === 0 || i === slots.length - 1) cells[s].classList.add("end");
  });
}

// ---- Painting each screen ---------------------------------------------------

function paint() {
  const busy = Boolean(state.busy);
  for (const id of ["from", "to", "start", "tfrom", "tto", "pick", "tpick", "tmode-empty", "tmode-all", "pacing"]) {
    $(id).disabled = busy;
  }
  $("connect").disabled = busy || $("connect").dataset.unsupported === "1";
  $("failed-readbacks").disabled = !state.failedReadbacks.length;
  if (state.screen === "backup") paintBackup();
  else if (state.screen === "restore") paintRestore();
  else if (state.screen === "template") paintTemplate();
}

/** The reason a button is greyed out, or "" if it can be pressed. */
function blocker(extra) {
  if (state.busy) return busyText();
  if (!state.device) return NOT_CONNECTED;
  return extra ?? "";
}

function busyText() {
  return { connect: "Reading the pedal...", backup: "Backing up...", restore: "Restoring...", template: "Writing..." }[state.busy];
}

function paintBackup() {
  const r = parseRange($("from").value, $("to").value);
  const why = blocker(r.error);
  $("go-backup").disabled = Boolean(why);
  $("why-backup").textContent = why;
  $("sum-backup").textContent = r.slots ? backupSummary(r.slots, nameOf) : "";
  paintList((cells) => r.slots && markRange(cells, r.slots, "sel"));
}

function restorePlan() {
  const st = parseStart($("start").value);
  const { picked, error } = state.restore;
  if (error) return { st, error };
  if (st.error) return { st, error: picked ? st.error : "Enter a start slot and choose files" };
  if (!picked) return { st, error: "Choose files to restore" };
  const plan = planUpload(picked.ordered, st.slot);
  if (!plan.items.length) return { st, plan, error: "Nothing to write" };
  return { st, plan };
}

function paintRestore() {
  const { st, plan, error } = restorePlan();
  const why = blocker(error);
  $("go-restore").disabled = Boolean(why);
  $("why-restore").textContent = why;
  $("show-after").disabled = !plan?.items.length;
  const sum = plan ? restoreSummary(plan, nameOf) : null;
  $("sum-restore").textContent = sum?.text ?? "";
  $("over-restore").textContent = sum?.overflowText ?? "";
  showList($("warn-restore"), [...(state.restore.picked?.notes ?? []), ...(plan ? planWarnings(plan).filter((w) => !w.includes("don't fit")) : [])]);
  const after = state.restore.showAfter && plan ? afterNames(plan.items) : null;
  paintList((cells) => {
    if (!plan) {
      if (st.slot !== undefined) cells[st.slot].classList.add("start");
      return;
    }
    markRange(cells, plan.items.map((it) => it.slot), "over");
    for (const it of plan.items) {
      const c = cells[it.slot];
      c.title = `${lab(it.slot)}: ${it.fileName} replaces "${nameOf(it.slot) ?? "(not read)"}"`;
      if (after) {
        c.querySelector(".nm").textContent = after.get(it.slot);
        c.classList.add("new");
      }
    }
    for (const sk of plan.skipped) cells[parseStart(sk.label).slot].title = `${sk.label}: ${sk.fileName} is ${sk.reason}`;
  });
}

function templatePlan() {
  const fromText = $("tfrom").value.trim();
  const toText = $("tto").value.trim();
  if (!fromText || !toText) return { error: "Enter From and To (e.g. 44-A and 51-D)" };
  const r = parseRange(fromText, toText);
  if (r.error) return r;
  if (state.template.error) return { slots: r.slots, error: state.template.error };
  if (!state.template.file) return { slots: r.slots, error: "Choose a .prst file" };
  if (!state.device) return { slots: r.slots, error: NOT_CONNECTED };
  const mode = $("tmode-all").checked ? "all" : "empty";
  const plan = planTemplate(state.template.file, r.slots, nameOf, mode);
  return { slots: r.slots, plan, error: plan.items.length ? null : "Nothing to write" };
}

function paintTemplate() {
  const { slots, plan, error } = templatePlan();
  const why = blocker(error);
  $("go-template").disabled = Boolean(why);
  $("why-template").textContent = why;
  $("tshow-after").disabled = !plan?.items.length;
  $("sum-template").textContent = plan ? templateScreenSummary(plan).text : "";
  showList($("warn-template"), plan ? templateWarnings(plan).filter((w) => !w.startsWith("Nothing to write")) : []);
  paintList((cells) => {
    for (const [s, kind] of templateMarks(slots, plan)) {
      cells[s].classList.add(kind);
      if (kind === "over") cells[s].classList.remove("def"); // shown as about to be replaced
    }
    if (slots) for (const s of [slots[0], slots[slots.length - 1]]) cells[s].classList.add("end");
    if (!plan) return;
    for (const it of plan.items) {
      const c = cells[it.slot];
      c.title = `${lab(it.slot)}: ${plan.fileName} replaces "${it.replaces ?? "(not read)"}"`;
      if (state.template.showAfter) {
        c.querySelector(".nm").textContent = plan.patchName;
        c.classList.add("new");
      }
    }
    for (const k of plan.kept) {
      cells[k.slot].title = `${lab(k.slot)}: kept (${k.name === null ? "couldn't be read" : `"${k.name}" is one of your patches`})`;
    }
  });
}

// ---- Connecting and reading the patch list ----------------------------------

async function onConnect() {
  $("connect").disabled = true;
  $("connect-msg").textContent = "";
  try {
    if (FAKE) return await connectFake();
    if (!state.midi) {
      log.info("Requesting MIDI access (with SysEx)...");
      state.midi = await navigator.requestMIDIAccess({ sysex: true });
      state.midi.addEventListener("statechange", onPortStateChange);
      fillPortPickers();
    }
    const input = state.midi.inputs.get($("in-port").value);
    const output = state.midi.outputs.get($("out-port").value);
    if (!input || !output) {
      $("port-picker").hidden = false;
      setConn("Pick the GP-200's ports");
      $("connect-msg").textContent =
        "Couldn't tell which device is the GP-200: pick its ports above, then press “Connect to pedal” again.";
      log.warn("Couldn't pick the GP-200's ports automatically; choose them from the lists.");
      return;
    }
    if (state.device) state.device.close();
    log.info(`Connecting: in="${input.name}" out="${output.name}"`);
    state.device = new GP200({ input, output, log });
    await state.device.connect();
    $("port-picker").hidden = true;
    setConn(`Connected: ${input.name}`, true);
    await afterConnect();
  } catch (e) {
    state.device = null;
    const msg = e?.name === "SecurityError" || e?.name === "NotAllowedError"
      ? "MIDI access was blocked. Allow it from the icon in the address bar, then press “Connect to pedal” again."
      : `Couldn't connect: ${e?.message ?? e}`;
    setConn("Not connected");
    setConnected(false);
    $("connect-msg").textContent = msg;
    setProgress(msg, "failed");
    log.error(msg);
    show(state.screen);
  } finally {
    paint();
  }
}

async function connectFake() {
  const { fakePorts } = await import("./fake-dev.js");
  const { input, output } = await fakePorts(log);
  state.device = new GP200({ input, output, log });
  await state.device.connect();
  setConn(`Connected: ${input.name}`, true);
  await afterConnect();
}

/** Leave the welcome panel for the right screen, then read the list. */
async function afterConnect() {
  setConnected(true);
  // Back up shows its default range in the boxes, not as grey hints
  // (developer, 2026-10-02); a range the user typed is kept.
  if (!$("from").value.trim() && !$("to").value.trim()) {
    $("from").value = lab(0);
    $("to").value = lab(TOTAL_SLOTS - 1);
  }
  const target = screenAfterConnect(state.screen, state.wasConnected);
  state.wasConnected = true;
  log.info(`Connected; showing ${target}`);
  if (location.hash.slice(1) !== target) location.hash = target; // its hashchange shows it again: harmless
  show(target); // the list fills in as it's read
  await refreshList("Reading the patches on the pedal");
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
  const nIn = fill($("in-port"), state.midi.inputs);
  const nOut = fill($("out-port"), state.midi.outputs);
  log.info(`MIDI ports: ${state.midi.inputs.size} input(s), ${state.midi.outputs.size} output(s); ` +
    `GP-200 matches: ${nIn} input(s), ${nOut} output(s)`);
  $("port-picker").hidden = nIn === 1 && nOut === 1;
}

function onPortStateChange(e) {
  const p = e.port;
  log.info(`MIDI port ${p.type} "${p.name}" is now ${p.state}/${p.connection}`);
  const d = state.device;
  if (p.state === "disconnected" && d && (p.id === d.input.id || p.id === d.output.id)) {
    dropConnection("Disconnected", "The pedal was disconnected. Plug it back in and press “Connect to pedal”.");
  }
  if (!state.device) fillPortPickers();
}

/**
 * Treat the pedal as gone: the welcome panel comes back with `msg` under
 * its Connect button. There's no other reconnect control (developer,
 * 2026-10-02: the header's Reconnect was never needed).
 */
function dropConnection(status, msg) {
  log.warn(`Connection dropped: ${msg}`);
  state.device?.close();
  state.device = null;
  state.names.fill(undefined); // the list shows the pedal; with no pedal, nothing
  setConn(status);
  setConnected(false);
  $("connect-msg").textContent = msg;
  show(state.screen);
}

/**
 * Re-read every name so the list shows what's on the pedal (on connect and
 * after every write, also one that stopped early or failed).
 * @param {string} what progress text while reading
 * @param {boolean} [keepMessage] leave the progress line's result in place
 */
async function refreshList(what, keepMessage = false) {
  const wasBusy = state.busy;
  if (!wasBusy) setBusy("connect");
  const previous = keepMessage ? [$("prog-label").innerHTML, $("prog-time").textContent] : null;
  try {
    const { names, skipped } = await readPatchList(state.device, {
      skeleton: skeletonBytes(),
      log,
      onProgress: ({ done, total }) => {
        if (!keepMessage) setProgress(`${what}: ${done} of ${total}`);
      },
    });
    state.names = names;
    if (!keepMessage) {
      setProgress(skipped.length
        ? `Read the pedal: ${skipped.length} slot(s) couldn't be read (${skipped.join(", ")}); they show as "(couldn't read)".`
        : "Ready.", skipped.length ? "failed" : "");
    } else {
      $("prog-label").innerHTML = previous[0];
      if (skipped.length) appendProgress(` The list couldn't re-read ${skipped.length} slot(s): ${skipped.join(", ")}.`);
    }
  } finally {
    if (!wasBusy) setBusy(false);
  }
}

// ---- Back up ----------------------------------------------------------------

async function onBackup() {
  const r = parseRange($("from").value, $("to").value);
  if (r.error || !state.device) return;
  const slots = r.slots;
  showList($("warn-backup"), []);
  setBusy("backup");
  log.info(`Backing up ${slots.length} slot(s): ${lab(slots[0])} to ${lab(slots.at(-1))}`);
  try {
    const result = await readSlots(state.device, slots, {
      skeleton: skeletonBytes(),
      log,
      onProgress: ({ done, total, label }) => setProgress(`Reading ${done} of ${total}: ${label}`),
    });
    for (const e of result.entries) state.names[e.slot] = e.name; // just read from the pedal
    for (const l of result.skipped) state.names[parseStart(l).slot] = null;
    const pkg = packageExport(slots, result);
    if (pkg) {
      download(pkg.fileName, pkg.bytes, pkg.fileName.endsWith(".zip") ? "application/zip" : "application/octet-stream");
      log.info(`Saved ${pkg.fileName} (${result.entries.length} patch(es))`);
      setProgress(`Saved ${pkg.fileName}: ${result.entries.length} patch(es) in ${(result.elapsedMs / 1000).toFixed(1)} s.`,
        result.skipped.length ? "failed" : "done");
    } else {
      setProgress("Nothing could be read; nothing saved.", "failed");
    }
    const warnings = exportWarnings(result);
    for (const w of warnings) log.warn(w);
    showList($("warn-backup"), warnings);
  } catch (e) {
    log.error(`Backup failed: ${e?.stack ?? e}`);
    setProgress(`Backup failed: ${e?.message ?? e}`, "failed");
  } finally {
    setBusy(false);
  }
}

// ---- Restore ----------------------------------------------------------------

async function onRestoreFiles() {
  const files = [...$("files").files];
  state.restore = { ...state.restore, picked: null, error: null };
  if (!files.length) {
    $("files-text").textContent = "No files chosen";
    return paint();
  }
  try {
    const picked = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    const { entries, notes } = await expandSources(picked);
    const { ordered, orderedBy } = orderEntries(entries);
    state.restore.picked = { ordered, notes };
    const source = files.length === 1 ? files[0].name : `${files.length} files`;
    $("files-text").textContent = `${source}: ${entries.length} patch(es), in order of ${orderedBy}`;
    log.info(`Restore files: ${files.map((f) => f.name).join(", ")}; ${entries.length} patch(es), ordered by ${orderedBy}`);
    for (const n of notes) log.warn(n);
  } catch (e) {
    state.restore.error = e.message;
    $("files-text").textContent = files.map((f) => f.name).join(", ");
    log.warn(`Restore files rejected: ${e.message}`);
  }
  paint();
}

async function onRestore() {
  const { plan } = restorePlan();
  if (!plan?.items.length || !state.device) return;
  const n = plan.items.length;
  if (!await confirmDialog(restoreConfirmText(plan, nameOf), `Restore ${n} patch${n === 1 ? "" : "es"}`)) {
    log.info("Restore cancelled at the confirmation; nothing written");
    return;
  }
  for (const w of planWarnings(plan)) log.warn(w);
  await runWrite("restore", plan.items, `Restoring ${n} patch(es) to ${lab(plan.items[0].slot)}-${lab(plan.items.at(-1).slot)}`,
    `Restored ${n} patch${n === 1 ? "" : "es"}`);
}

// ---- Template ---------------------------------------------------------------

async function onTemplateFile() {
  const f = $("tfile").files[0];
  state.template = { ...state.template, file: null, error: null };
  if (!f) {
    $("tfile-text").textContent = "No file chosen";
    return paint();
  }
  const data = new Uint8Array(await f.arrayBuffer());
  state.template.file = { name: f.name, data };
  try {
    const name = planTemplate(state.template.file, [0], () => null).patchName; // validates the file
    $("tfile-text").textContent = `${f.name} ("${name}")`;
    log.info(`Template file: ${f.name}, patch "${name}"`);
  } catch (e) {
    state.template = { ...state.template, file: null, error: e.message };
    $("tfile-text").textContent = f.name;
    log.warn(`Template file rejected: ${e.message}`);
  }
  paint();
}

async function onTemplate() {
  const { plan } = templatePlan();
  if (!plan?.items.length || !state.device) return;
  const n = plan.items.length;
  if (!await confirmDialog(templateConfirmText(plan), `Write to ${n} slot${n === 1 ? "" : "s"}`)) {
    log.info("Template cancelled at the confirmation; nothing written");
    return;
  }
  log.info(`Template plan: ${templateSummary(plan)}`);
  for (const w of templateWarnings(plan)) log.warn(w);
  setBusy("template");
  let check;
  try {
    setProgress("Checking the range on the pedal before writing");
    check = await recheckTemplate(state.device, plan, { skeleton: skeletonBytes(), log });
    for (const [s, name] of check.names) state.names[s] = name; // the list shows what was just read
  } catch (e) {
    log.error(`Template stopped: ${e?.stack ?? e}`);
    setProgress(`Template stopped before writing: ${e?.message ?? e}`, "failed");
    setBusy(false);
    return;
  }
  if (!check.ok) {
    setBusy(false);
    const changes = check.changed.map((c) => `${lab(parseStart(c.label).slot)} "${c.was ?? "not read"}" is now "${c.now ?? "unreadable"}"`);
    setProgress(`The pedal changed since its patches were read (${changes.join("; ")}). Nothing written. ` +
      "The plan below is updated; check it and press Write to range again.", "failed");
    paint();
    return;
  }
  await runWrite("template", plan.items, `Writing ${plan.fileName} to ${n} slot(s)`,
    `Wrote ${plan.fileName} to ${n} slot${n === 1 ? "" : "s"}`);
}

// ---- Writing (restore and template) -----------------------------------------

async function runWrite(kind, items, what, doneText) {
  const n = items.length;
  state.failedSlots.clear();
  state.failedReadbacks = [];
  setBusy(kind);
  log.info(what);
  const cli = DEV && $("pacing").value === "cli";
  state.device.timing = cli ? CLI_WRITE_TIMING : WRITE_TIMING;
  const started = performance.now();
  startTimer(started);
  setBar(0);
  let out = null;
  try {
    out = await writeSlots(state.device, items, {
      skeleton: skeletonBytes(),
      log,
      isCancelled: () => state.cancelRequested,
      wasHidden,
      onProgress: ({ done, total }) => {
        setBar(done / total);
        const next = items[done];
        setProgress(next ? `Writing ${done + 1} of ${total}: ${lab(next.slot)} ${next.patchName}` : `Wrote ${done} of ${total}`);
      },
    });
  } catch (e) {
    log.error(`${kind === "restore" ? "Restore" : "Template"} stopped: ${e?.stack ?? e}`);
    setProgress(`Stopped: ${e?.message ?? e}. The list below is read again from the pedal.`, "failed");
  }
  stopTimer();
  $("prog-time").textContent = ""; // the result line carries the time
  const secs = ((performance.now() - started) / 1000).toFixed(1);
  if (out) {
    for (const r of out.failed) state.failedSlots.add(r.slot);
    state.failedReadbacks = out.failed.filter((r) => r.roundtrip);
    const ok = out.results.length - out.failed.length;
    const noun = kind === "restore" ? "Restored" : "Wrote";
    if (out.failed.length) {
      setProgress(`${noun} ${out.results.length} of ${n}: ${ok} verified, ${out.failed.length} NOT verified ` +
        `(${out.failed.map((r) => lab(r.slot)).join(", ")}; marked in red, see Help).` +
        (out.cancelled ? " Stopped early; the rest were not written." : ""), "failed");
    } else if (out.cancelled) {
      setProgress(`Stopped after ${out.results.length} of ${n}, all verified; the rest were not written.`, "failed");
    } else {
      setProgress(`${doneText}, all verified, in ${secs} s.`, "done");
    }
  }
  // The list always shows the pedal: read it again, whatever happened.
  $("stop").disabled = true;
  try {
    await refreshList("Reading the pedal again", true);
  } catch (e) {
    log.error(`Couldn't re-read the patch list: ${e?.stack ?? e}`);
    // The pedal isn't answering: back to the welcome panel, with the
    // write's result there since the progress line is hidden with the list.
    dropConnection("Not connected", `${$("prog-label").textContent} Then the pedal stopped answering, so the list ` +
      "couldn't be read again. Check the USB cable and press “Connect to pedal”.");
  }
  setBusy(false);
}

// ---- Busy state, progress, confirmation -------------------------------------

function setBusy(what) {
  state.busy = what;
  if (what) {
    state.cancelRequested = false;
    $("hidden-banner").hidden = true;
  }
  const writing = what === "restore" || what === "template";
  $("stop").disabled = !writing;
  if (!writing) setBar(null);
  holdWakeLock(Boolean(what));
  paint();
}

function setProgress(text, kind = "") {
  const el = $("prog-label");
  el.textContent = text;
  el.className = kind;
}

function appendProgress(text) {
  $("prog-label").append(text);
}

function setBar(fraction) {
  $("prog-bar").style.width = fraction === null ? "0" : `${Math.round(fraction * 100)}%`;
  $("prog-bar").parentElement.classList.toggle("idle", fraction === null);
}

function startTimer(started) {
  stopTimer();
  const tick = () => { $("prog-time").textContent = `${((performance.now() - started) / 1000).toFixed(1)} s`; };
  tick();
  state.timer = setInterval(tick, 100);
}

function stopTimer() {
  clearInterval(state.timer);
  state.timer = null;
}

/** The app's own confirmation dialog; resolves true on the OK button. */
function confirmDialog(text, okLabel) {
  const dlg = $("confirm");
  $("confirm-text").textContent = text;
  $("confirm-ok").textContent = okLabel;
  return new Promise((resolve) => {
    const done = (ok) => {
      $("confirm-ok").onclick = null;
      $("confirm-cancel").onclick = null;
      dlg.onclose = null;
      if (dlg.open) dlg.close();
      resolve(ok);
    };
    $("confirm-ok").onclick = () => done(true);
    $("confirm-cancel").onclick = () => done(false);
    dlg.onclose = () => done(false); // Esc
    dlg.showModal();
    $("confirm-cancel").focus();
  });
}

// ---- Hidden tabs and screen sleep (DEV_JOURNAL.md T1) -----------------------
// Chrome slows timers in background tabs, and the write pacing runs on
// timers. Log every change, warn when it happens mid-write, and keep the
// screen awake during jobs. Same behaviour as the test page.

const writing = () => state.busy === "restore" || state.busy === "template";
const wasHidden = (since) => document.hidden || state.lastVisibleAgainAt >= since;

function onVisibilityChange() {
  if (document.hidden) {
    state.hiddenAt = performance.now();
    if (writing()) log.warn("Page hidden while writing: the browser may slow the writes down until it's visible again");
    else log.info("Page hidden");
    return;
  }
  const secs = state.hiddenAt === null ? 0 : (performance.now() - state.hiddenAt) / 1000;
  state.hiddenAt = null;
  state.lastVisibleAgainAt = performance.now();
  if (writing()) {
    log.warn(`Page visible again after ${secs.toFixed(1)} s hidden during the write`);
    $("hidden-banner").textContent = `This page was in the background for ${secs.toFixed(0)} s while writing. ` +
      "Browsers slow down background pages, so the writes may have taken longer. " +
      "Keep this tab in front until writing finishes.";
    $("hidden-banner").hidden = false;
  } else {
    log.info(`Page visible again after ${secs.toFixed(1)} s hidden`);
  }
  if (state.busy) holdWakeLock(true); // the browser drops the lock when the page is hidden
}

async function holdWakeLock(hold) {
  if (!hold) {
    const lock = state.wakeLock;
    state.wakeLock = null;
    if (lock && !lock.released) {
      await lock.release().catch(() => {});
      log.debug("Screen wake lock released");
    }
    return;
  }
  if (state.wakeLock && !state.wakeLock.released) return;
  if (!navigator.wakeLock) {
    log.debug("This browser has no screen wake lock; the screen may sleep during long jobs");
    return;
  }
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    log.debug("Screen wake lock on: the screen won't sleep while this runs");
    if (!state.busy) holdWakeLock(false); // the job ended while we were asking
  } catch (e) {
    log.info(`Couldn't keep the screen awake (${e?.message ?? e}); if it sleeps mid-restore, writes slow down`);
  }
}

// ---- Small helpers ----------------------------------------------------------

/** The welcome panel: the connect steps and button, or (connected) a note. */
function setConnected(connected) {
  $("connect-area").hidden = connected;
  $("connected-note").hidden = !connected;
}

function setConn(text, ok = false) {
  $("conn-status").textContent = text;
  $("conn-status").classList.toggle("ok", ok);
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
  $("unsupported").textContent = text;
  $("unsupported").hidden = false;
  $("connect").dataset.unsupported = "1";
  setConn("Can't reach the pedal in this browser");
  log.error(text);
}

function appendLogLine(line) {
  const el = $("log");
  if (!el) return;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
  el.append(line + "\n");
  if (atBottom) el.scrollTop = el.scrollHeight;
}

/** Save the log to a file; returns its name. */
function saveLog() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `gp200_web_${stamp}.log`;
  download(fileName, new TextEncoder().encode(log.text(environmentInfo())), "text/plain");
  log.info(`Log saved: ${fileName}`);
  return fileName;
}

/**
 * Report a problem (Help): save the log, then open GitHub's new-issue form
 * in a new tab, filled in with the version, browser and last error. The
 * user writes the rest, drags the log in and posts it; the app sends nothing.
 */
function onReport() {
  log.info("Report a problem: saving the log and opening GitHub's new-issue form");
  const logFile = saveLog();
  const url = issueUrl({
    version: VERSION,
    browser: browserSummary(navigator.userAgentData, navigator.userAgent),
    page: location.host || location.protocol,
    connected: Boolean(state.device),
    screen: state.screen,
    lastError: log.lastError,
    logFile,
  });
  log.info(`Issue link: ${url.length} characters`);
  // An <a> click, like the footer's links: opens a new tab, and the
  // message below keeps the same link in case a blocker stopped it.
  const a = Object.assign(document.createElement("a"), { href: url, target: "_blank", rel: "noopener" });
  a.textContent = "open GitHub's form";
  const msg = $("report-msg");
  msg.replaceChildren(`Saved ${logFile}. In the GitHub tab, describe the problem and drag that file into the box. ` +
    "No GitHub tab? ", a, ".");
  const opener = a.cloneNode(true);
  document.body.append(opener);
  opener.click();
  opener.remove();
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
  if (uad) lines.push(`Browser: ${uad.brands.map((b) => `${b.brand} ${b.version}`).join(", ")}; platform ${uad.platform}`);
  const midi = state.midi;
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
  lines.push(`Page: ${document.hidden ? "hidden" : "visible"}; screen: ${state.screen}; developer tools: ${DEV ? "shown" : "off"}; ` +
    `screen wake lock: ${navigator.wakeLock ? "available" : "not available"}; window ${innerWidth}x${innerHeight}`);
  lines.push(`Connected: ${state.device ? `in="${state.device.input.name}" out="${state.device.output.name}"` : "no"}`);
  return lines;
}
