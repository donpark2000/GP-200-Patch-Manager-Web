// A Web MIDI-like input and output for the GP-50 under Node, through
// midi_bridge.py (Windows only; Python, nothing to install).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const BRIDGE = ["python", "-u", fileURLToPath(new URL("midi_bridge.py", import.meta.url))];
const OPEN_TIMEOUT_MS = 10000;
/** A message Windows took longer than this to send is worth seeing in the log. */
const SLOW_SEND_MS = 50;

/** Puts SysEx messages back together, however Windows cut them into buffers. */
export class SysexStream {
  constructor(onMessage, onStray) {
    Object.assign(this, { onMessage, onStray });
    this.part = [];
  }

  push(bytes) {
    for (const b of bytes) {
      if (b === 0xf0) {
        if (this.part.length) this.onStray(this.part);
        this.part = [b];
      } else if (!this.part.length) {
        this.onStray([b]);
      } else {
        this.part.push(b);
        if (b === 0xf7) {
          const msg = this.part;
          this.part = [];
          this.onMessage(msg);
        }
      }
    }
  }
}

/**
 * @param {object} [opts]
 * @param {string[]} [opts.command] the helper to run
 * @param {(reason: string) => void} [opts.onGone] the connection ended by itself
 * @param {"gp50"|"gp200"} [opts.pedal] which pedal's port; the GP-200's is
 *   opened read-only (midi_bridge.py refuses anything but reads)
 * @param {boolean} [opts.gp200Writes] GP-200 only: also let patch writes
 *   through the bridge (gp200-restore; gp200.js checks each one)
 * @returns {Promise<{input, output, ports, close: () => Promise<void>}>}
 */
export function connect(log, { command = BRIDGE, onGone = () => {}, pedal = "gp50", gp200Writes = false } = {}) {
  if (gp200Writes && pedal !== "gp200") throw new Error("gp200Writes is for the GP-200 only");
  const args = [...command.slice(1), ...(pedal === "gp50" ? [] : ["--pedal", pedal]), ...(gp200Writes ? ["--gp200-patch-writes"] : [])];
  const child = spawn(command[0], args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const input = { name: null, onmidimessage: null };
  let gone = null; // why the connection ended
  let closing = false;
  let ready = false;
  let ports = null;
  let fatal = null;
  let stderr = "";
  const stream = new SysexStream(
    (msg) => input.onmidimessage?.({ data: Uint8Array.from(msg) }),
    (bytes) => log.warn(`Bytes outside a whole SysEx message: ${Buffer.from(bytes).toString("hex")}`),
  );
  const output = {
    name: null,
    send: (msg) => {
      if (gone || closing) throw new Error(`the MIDI connection is closed${gone ? ` (${gone})` : ""}`);
      child.stdin.write(`tx ${Buffer.from(msg).toString("hex")}\n`);
    },
  };
  const exited = new Promise((resolve) => { child.on("close", resolve); });
  const close = async () => {
    closing = true;
    if (!gone) child.stdin.end("close\n");
    await exited;
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      fatal = `the MIDI helper didn't open the port within ${OPEN_TIMEOUT_MS / 1000} s`;
      child.kill();
    }, OPEN_TIMEOUT_MS);
    const line = (text) => {
      const [kind] = text.split(" ", 1);
      const rest = text.slice(kind.length + 1);
      if (kind === "rx") {
        const [stamp, hex] = rest.split(" ");
        log.debug(`Windows received ${hex.length / 2} bytes, its clock ${stamp} ms`);
        stream.push(Buffer.from(hex, "hex"));
      } else if (kind === "sent") {
        if (Number(rest) > SLOW_SEND_MS) log.warn(`Windows took ${rest} ms to send that`);
      } else if (kind === "ports") {
        ports = JSON.parse(rest);
        log.info(`MIDI ports: in ${JSON.stringify(ports.in)}, out ${JSON.stringify(ports.out)}`);
      } else if (kind === "ready") {
        [input.name, output.name] = rest.split(" | ");
        ready = true;
        clearTimeout(timer);
        log.info(`Ports open: in "${input.name}", out "${output.name}"`);
        resolve({ input, output, ports, close });
      } else if (kind === "fatal") {
        fatal = rest;
      } else {
        log.warn(`MIDI helper: ${text}`);
      }
    };
    let pending = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      const lines = (pending + d).split(/\r?\n/);
      pending = lines.pop();
      lines.filter(Boolean).forEach(line);
    });
    child.stderr.on("data", (d) => { stderr += d; });
    child.stdin.on("error", () => {}); // reported by "close"
    child.on("error", (err) => { fatal = `the MIDI helper couldn't be started: ${err.message}`; });
    child.on("close", (code) => {
      clearTimeout(timer);
      gone = fatal ?? (stderr.trim().split("\n").pop() || `the MIDI helper ended, code ${code}`);
      if (!ready) reject(new Error(gone));
      else if (!closing) {
        log.error(`Connection lost: ${gone}`);
        onGone(gone);
      }
    });
  });
}
