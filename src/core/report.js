// "Report a problem" (DESIGN.md, Help): the link to GitHub's new-issue form,
// filled in with what the app knows. The user still writes the description,
// drags in the saved log and presses Create; nothing is sent by the app.
// A link can't carry a file, and GitHub refuses very long links, so the log
// itself isn't in it and the last error is shortened to keep under MAX_URL.

export const NEW_ISSUE_URL = "https://github.com/donpark2000/GP-200-Patch-Manager-Web/issues/new";
export const MAX_URL = 6000; // characters; GitHub's own limit is about 8,000

/**
 * @param {object} info
 * @param {string} info.version app version (src/version.js)
 * @param {string} info.browser e.g. "Google Chrome 141 on Windows"
 * @param {string} info.page where the app ran, e.g. "donpark2000.github.io" or "localhost:8001"
 * @param {boolean} info.connected the pedal was connected
 * @param {string} info.screen the screen showing (backup, restore, ...)
 * @param {string|null} info.lastError the log's last error, if any
 * @param {string} info.logFile the log file just saved
 * @param {number} [errorMax] longest last error kept (shortened further if the link is too long)
 * @returns {{title: string, body: string}}
 */
export function issueText(info, errorMax = 1500) {
  const err = info.lastError ? oneLine(info.lastError) : null;
  const shortErr = err && err.length > errorMax ? `${err.slice(0, errorMax)}... (shortened; the log has it all)` : err;
  const body = [
    "### What I was doing",
    "",
    "",
    "### What happened",
    "",
    "",
    "### Log",
    `Drag the log file you saved (${info.logFile}) into this box. It lists your patch names, and this issue is public.`,
    "",
    "### Details (filled in by the app)",
    `- App version: ${info.version}`,
    `- Browser: ${info.browser}`,
    `- Page: ${info.page}`,
    `- Pedal connected: ${info.connected ? "yes" : "no"}`,
    `- Screen: ${info.screen}`,
    `- Last error: ${shortErr ?? "none"}`,
    "",
  ].join("\n");
  return { title: "Problem: ", body };
}

/** The new-issue link, never longer than MAX_URL. */
export function issueUrl(info) {
  for (let errorMax = 1500; ; errorMax = Math.floor(errorMax / 2)) {
    const { title, body } = issueText(info, errorMax);
    const url = `${NEW_ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    if (url.length <= MAX_URL || errorMax < 20) return url;
  }
}

/**
 * "Google Chrome 141 on Windows" from navigator.userAgentData, else the
 * user agent. Browsers list a decoy brand ("Not?A_Brand" and variants) on
 * purpose, and "Chromium" next to the real name; prefer the real name,
 * then Chromium, never the decoy.
 * @param {{brands?: {brand: string, version: string}[], platform?: string} | undefined} uaData
 * @param {string} userAgent
 */
export function browserSummary(uaData, userAgent) {
  const brands = (uaData?.brands ?? []).filter((b) => !/not.?a.?brand/i.test(b.brand));
  const brand = brands.find((b) => !/^chromium$/i.test(b.brand)) ?? brands[0];
  if (!brand) return userAgent;
  return `${brand.brand} ${brand.version} on ${uaData.platform || "unknown OS"}`;
}

const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();
