// What the two GP-50 test pages share: the log, connecting, and running one
// button's action at a time. Sends nothing itself.

import { Logger } from "../src/core/log.js";
import { isGp50Name } from "./device.js";

const LOG_LINES_SHOWN = 1000;

export const $ =(id) => document.getElementById(id);

export const fileStamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

export function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * @param {object} opts
 * @param {string[]} opts.buttons ids of the buttons that need the pedal
 * @param {(id: string) => string|null} [opts.whyNot] why a button can't be pressed now, beyond being
 *   connected; shown in the element `<id>-why` if there is one
 * @returns {{log: Logger, reader: object|null, action: Function, refresh: Function}}
 */
export function startPage({ title, buttons, makeReader, makeFake, whyNot = () => null }) {
  // Shown in batches, the last lines only: redrawing the whole log for every
  // message slowed the page more and more. "Save log" has every line.
  let shown = [];
  let showing = false;
  const log = new Logger({
    onLine: (line) => {
      shown.push(line);
      if (showing) return;
      showing = true;
      setTimeout(() => {
        showing = false;
        shown = shown.slice(-LOG_LINES_SHOWN);
        $("log").textContent = shown.join("\n");
        $("log").scrollTop = $("log").scrollHeight;
      }, 250);
    },
  });
  log.debugEnabled = true;
  const page = { log, reader: null, action, refresh };
  let access = null;
  let busy = false;

  log.info(`${title}. ${navigator.userAgent}`);

  $("connect").addEventListener("click", connect);
  $("debug").addEventListener("change", () => { log.debugEnabled = $("debug").checked; });
  $("clear-log").addEventListener("click", () => {
    log.clear();
    shown = [];
    $("log").textContent = "";
  });
  $("save-log").addEventListener("click", () => {
    const header = [title, `Saved: ${new Date().toISOString()}`, `Page: ${location.href}`, `Browser: ${navigator.userAgent}`, ...portLines()];
    download(`gp50_test_${fileStamp()}.log`, log.text(header), "text/plain");
  });

  async function connect() {
    $("connect").disabled = true;
    try {
      if (new URLSearchParams(location.search).has("fake")) {
        const { FakeGp50 } = await import("./fake-gp50.js");
        if (!access) {
          const pedal = makeFake(FakeGp50);
          access = { inputs: new Map([["i", pedal.input]]), outputs: new Map([["o", pedal.output]]) };
        }
      } else if (!navigator.requestMIDIAccess) {
        throw new Error("This browser has no Web MIDI; use Chrome or Edge on a computer");
      } else if (!access) {
        log.info("Requesting MIDI access (with SysEx)...");
        access = await navigator.requestMIDIAccess({ sysex: true });
        access.onstatechange = (e) => {
          log.info(`Port ${e.port.type} "${e.port.name}": ${e.port.state}, ${e.port.connection}`);
          if (page.reader && e.port.state === "disconnected" && (e.port === page.reader.input || e.port === page.reader.output)) {
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
      page.reader?.close();
      page.reader = makeReader(input, output, log);
      refresh();
      $("status").textContent = `Ports open: in "${input.name}", out "${output.name}". Nothing sent yet.`;
      log.info("Ports open; nothing sent yet");
    } catch (err) {
      disconnect(`Couldn't connect: ${err.message}`);
      log.error(`Connect failed: ${err.name}: ${err.message}`);
    } finally {
      $("connect").disabled = busy;
    }
  }

  function disconnect(message) {
    page.reader?.close();
    page.reader = null;
    refresh();
    $("status").textContent = message;
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
      busy = true;
      refresh();
      $("result").textContent = "Working...";
      try {
        $("result").textContent = await run();
        log.info($("result").textContent);
      } catch (err) {
        $("result").textContent = err.message;
        log.error(err.message);
      } finally {
        busy = false;
        refresh();
      }
    });
  }

  function refresh() {
    $("connect").disabled = busy;
    for (const id of buttons) {
      const why = busy ? "Busy: wait until it's done." : !page.reader ? "Connect first." : whyNot(id);
      $(id).disabled = why !== null;
      const note = document.getElementById(`${id}-why`);
      if (note) note.textContent = why ?? "";
    }
  }

  function portLines() {
    if (!access) return ["MIDI ports: not asked for yet"];
    const list = (kind, ports) => [...ports.values()].map((p) =>
      `MIDI ${kind}: "${p.name}" manufacturer "${p.manufacturer ?? ""}" version "${p.version ?? ""}" ${p.state ?? ""} ${p.connection ?? ""}`);
    const lines = [...list("input", access.inputs), ...list("output", access.outputs)];
    return lines.length ? lines : ["MIDI ports: none"];
  }

  // Leaving mid-write would leave the pedal with half a patch.
  addEventListener("beforeunload", (e) => { if (busy) e.preventDefault(); });

  return page;
}
