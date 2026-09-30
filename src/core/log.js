// The app's debug log (standards section 1). Every line is timestamped
// relative to when the log started, like the CLI's --debug output. Debug
// lines (raw MIDI traffic) are only kept while debug is switched on.

export class Logger {
  /**
   * @param {object} [opts]
   * @param {() => number} [opts.now] milliseconds clock
   * @param {(line: string, level: string) => void} [opts.onLine] called for each kept line
   */
  constructor({ now = () => performance.now(), onLine = () => {} } = {}) {
    this.now = now;
    this.onLine = onLine;
    this.t0 = now();
    this.lines = [];
    this.debugEnabled = false;
  }

  info(msg) { this._add("INFO", msg); }
  warn(msg) { this._add("WARN", msg); }
  error(msg) { this._add("ERROR", msg); }
  debug(msg) { if (this.debugEnabled) this._add("DEBUG", msg); }

  _add(level, msg) {
    const secs = ((this.now() - this.t0) / 1000).toFixed(3).padStart(8);
    const line = `[+${secs}s] ${level.padEnd(5)} ${msg}`;
    this.lines.push(line);
    this.onLine(line, level);
  }

  clear() {
    this.lines = [];
  }

  /** Full log text for "save log", with an environment header on top. */
  text(headerLines = []) {
    return [...headerLines, "", ...this.lines, ""].join("\n");
  }
}
