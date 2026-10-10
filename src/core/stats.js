// The site's usage stats (DESIGN.md "Stats"; developer, 2026-10-10): which
// screens are opened and which actions are used, from which countries, over
// time. No DOM code: src/ui/stats.js sends the counts. Same approach as the
// developer's Web-Games site.
//
// The counts go to GoatCounter (goatcounter.com: free, no cookies, nothing
// personal kept), as one small request each: the page's own few lines, no
// script from another site. Its dashboard is public, linked from the
// footer ("Stats"). Only the live site counts, so testing on localhost, in
// an automated browser or with ?dev doesn't add to the numbers.

import { SCREENS } from "./screens.js";

export const GOATCOUNTER = "donpark-gp200"; // the site's code: https://<code>.goatcounter.com
export const LIVE_HOST = "donpark2000.github.io";

/**
 * The actions counted, one per screen (developer, 2026-10-10): connect
 * (welcome page), a backup saved, a restore or a Template run that wrote at
 * least one patch.
 */
export const ACTIONS = ["connect", "backup", "restore", "template"];

/** The dashboard (the footer's "Stats" link). */
export const statsPage = (code = GOATCOUNTER) => `https://${code}.goatcounter.com/`;

/**
 * Whether this page should send counts: only on the live site, not in an
 * automated browser (navigator.webdriver), and not with ?dev (the
 * developer's own testing on the live site).
 */
export function shouldCount({ hostname, webdriver = false, dev = false }) {
  return hostname === LIVE_HOST && !webdriver && !dev;
}

/**
 * A landing on a screen as the dashboard shows it: the page's full path,
 * which GoatCounter links to on the site's domain, with the screen after
 * '#' so the link opens that screen: '/GP-200-Patch-Manager-Web/' (home),
 * '/GP-200-Patch-Manager-Web/#help'.
 */
export function landingPath(pathname, screen) {
  if (!SCREENS.includes(screen)) throw new Error(`landingPath: no screen "${screen}"`);
  const parts = String(pathname || "/").split("/");
  if (parts.at(-1) === "index.html") parts[parts.length - 1] = "";
  let path = parts.join("/");
  if (!path.startsWith("/")) path = `/${path}`;
  return screen === "home" ? path : `${path}#${screen}`;
}

/** An action's event name, refused unless it's one of ACTIONS. */
export function actionEvent(name) {
  if (!ACTIONS.includes(name)) throw new Error(`actionEvent: no action "${name}"`);
  return name;
}

/**
 * The referrer worth keeping: another site that sent the visitor, not this
 * site itself.
 */
export function otherSite(referrer, hostname) {
  try {
    const u = new URL(referrer);
    return u.hostname && u.hostname !== hostname ? referrer : "";
  } catch {
    return "";
  }
}

/**
 * The count's address (GoatCounter's /count, help page "Tracking pixel"):
 * p the page or event name, t the title, r the referrer, s the screen
 * (width,height,scale), e an event, rnd a cache buster so a repeat is sent.
 */
export function countUrl(code, { path, title = "", referrer = "", screen = "", event = false, rnd = "" }) {
  if (!path) throw new Error("countUrl: no path");
  if (event && path.startsWith("/")) throw new Error(`countUrl: an event name can't start with '/': ${path}`);
  if (!event && !path.startsWith("/")) throw new Error(`countUrl: a page must start with '/': ${path}`);
  const q = new URLSearchParams({ p: path });
  if (title) q.set("t", title);
  if (referrer) q.set("r", referrer);
  if (screen) q.set("s", screen);
  if (event) q.set("e", "true");
  if (rnd) q.set("rnd", rnd);
  return `https://${code}.goatcounter.com/count?${q}`;
}
