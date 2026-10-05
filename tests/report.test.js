// "Report a problem" (src/core/report.js) and the logger's last error.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Logger } from "../src/core/log.js";
import { browserSummary, issueText, issueUrl, MAX_URL, NEW_ISSUE_URL } from "../src/core/report.js";

const info = {
  version: "abc1234 (2026-10-02)",
  browser: "Google Chrome 141 on Windows",
  page: "donpark2000.github.io",
  connected: true,
  screen: "restore",
  lastError: "Couldn't connect: no reply\n  to the identity query",
  logFile: "gp200_web_2026-10-02T19-30-00.log",
};

/** The title and body a link carries, read back the way GitHub reads them. */
function decode(url) {
  const u = new URL(url);
  return { base: `${u.origin}${u.pathname}`, title: u.searchParams.get("title"), body: u.searchParams.get("body") };
}

test("the issue link: GitHub's new-issue form with the details filled in", () => {
  const d = decode(issueUrl(info));
  assert.equal(d.base, NEW_ISSUE_URL);
  assert.equal(d.title, "Problem: ");
  assert.equal(d.body, issueText(info).body, "the body survives the link unchanged");
  assert.match(d.body, /^### What I was doing\n\n\n### What happened\n/);
  assert.match(d.body, /### Pedal model and firmware\ne\.g\. GP-200, firmware 1\.8\.0 \(the app can't read these from the pedal\)\n/);
  assert.match(d.body, /Drag the log file you saved \(gp200_web_2026-10-02T19-30-00\.log\) into this box/);
  assert.match(d.body, /this issue is public/);
  assert.match(d.body, /- App version: abc1234 \(2026-10-02\)\n- Browser: Google Chrome 141 on Windows\n/);
  assert.match(d.body, /- Pedal connected: yes\n- Screen: restore\n/);
  assert.match(d.body, /- Last error: Couldn't connect: no reply to the identity query\n/, "on one line");
});

test("the issue link: no error says none; not connected says no", () => {
  const { body } = decode(issueUrl({ ...info, lastError: null, connected: false }));
  assert.match(body, /- Last error: none\n/);
  assert.match(body, /- Pedal connected: no\n/);
});

test("the issue link: a huge error is shortened so the link stays under the limit", () => {
  const huge = "x".repeat(20_000);
  const url = issueUrl({ ...info, lastError: huge });
  assert.ok(url.length <= MAX_URL, `${url.length} characters`);
  const { body } = decode(url);
  assert.match(body, /- Last error: x+\.\.\. \(shortened; the log has it all\)\n/);
  // Characters that grow when encoded (each "é" is 6) still fit.
  assert.ok(issueUrl({ ...info, lastError: "é".repeat(5_000) }).length <= MAX_URL);
});

test("the logger remembers the last error until cleared", () => {
  const log = new Logger({ now: () => 0 });
  assert.equal(log.lastError, null);
  log.error("first");
  log.warn("a warning is not an error");
  log.error("second");
  assert.equal(log.lastError, "second");
  log.clear();
  assert.equal(log.lastError, null);
});

test("browser summary: the real name, never the decoy brand", () => {
  const b = (...pairs) => pairs.map(([brand, version]) => ({ brand, version }));
  const chrome = { brands: b(["Google Chrome", "141"], ["Chromium", "141"], ["Not_A Brand", "24"]), platform: "Windows" };
  assert.equal(browserSummary(chrome, "UA"), "Google Chrome 141 on Windows");
  const edge = { brands: b(["Not?A_Brand", "99"], ["Microsoft Edge", "141"], ["Chromium", "141"]), platform: "macOS" };
  assert.equal(browserSummary(edge, "UA"), "Microsoft Edge 141 on macOS");
  // Only Chromium and the decoy (seen in the desktop app's built-in browser, 2026-10-02).
  const bare = { brands: b(["Not?A_Brand", "24"], ["Chromium", "140"]), platform: "Windows" };
  assert.equal(browserSummary(bare, "UA"), "Chromium 140 on Windows");
  assert.equal(browserSummary({ brands: b(["Not)A;Brand", "8"]), platform: "" }, "Mozilla/5.0 UA"), "Mozilla/5.0 UA");
  assert.equal(browserSummary(undefined, "Mozilla/5.0 (Firefox)"), "Mozilla/5.0 (Firefox)");
  assert.equal(browserSummary({ brands: b(["Opera", "120"]) }, "UA"), "Opera 120 on unknown OS");
});
