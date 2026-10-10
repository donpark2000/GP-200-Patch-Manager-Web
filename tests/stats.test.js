// The site's usage stats (src/core/stats.js, DESIGN.md "Stats"): only the
// live site counts, landings and actions as GoatCounter takes them, and the
// app counts every screen and every action. No request is ever sent here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SCREENS } from "../src/core/screens.js";
import {
  ACTIONS, actionEvent, countUrl, GOATCOUNTER, landingPath, LIVE_HOST, otherSite, shouldCount, statsPage,
} from "../src/core/stats.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(REPO, f), "utf8");
const SITE = "/GP-200-Patch-Manager-Web/";

test("stats: only the live site counts; not an automated browser or ?dev", () => {
  assert.equal(LIVE_HOST, "donpark2000.github.io");
  assert.equal(shouldCount({ hostname: LIVE_HOST }), true);
  assert.equal(shouldCount({ hostname: "localhost" }), false);
  assert.equal(shouldCount({ hostname: "127.0.0.1" }), false);
  assert.equal(shouldCount({ hostname: "" }), false, "a file:// page");
  assert.equal(shouldCount({ hostname: "donpark2000.github.io.example.com" }), false, "a look-alike host");
  assert.equal(shouldCount({ hostname: LIVE_HOST, webdriver: true }), false);
  assert.equal(shouldCount({ hostname: LIVE_HOST, dev: true }), false);
});

test("stats: a landing is the page's path, with the screen after '#' (home: none)", () => {
  assert.equal(landingPath(SITE, "home"), SITE);
  assert.equal(landingPath(`${SITE}index.html`, "home"), SITE, "index.html is its folder");
  assert.equal(landingPath(SITE, "help"), `${SITE}#help`);
  assert.equal(landingPath(`${SITE}index.html`, "template"), `${SITE}#template`);
  assert.equal(landingPath("", "home"), "/");
  for (const s of SCREENS) assert.ok(landingPath(SITE, s).startsWith(SITE), s);
  assert.equal(SCREENS.length, 5, "home, backup, restore, template, help");
  assert.throws(() => landingPath(SITE, "settings"), /no screen "settings"/);
  assert.throws(() => landingPath(SITE, ""), /no screen ""/);
});

test("stats: the four actions, and nothing else, are events", () => {
  assert.deepEqual(ACTIONS, ["connect", "backup", "restore", "template"]);
  for (const a of ACTIONS) assert.equal(actionEvent(a), a);
  assert.throws(() => actionEvent("backup-all"), /no action "backup-all"/);
  assert.throws(() => actionEvent("help"), /no action "help"/);
});

test("stats: the referrer is kept only when another site sent the visitor", () => {
  assert.equal(otherSite("https://www.facebook.com/groups/x", LIVE_HOST), "https://www.facebook.com/groups/x");
  assert.equal(otherSite(`https://${LIVE_HOST}${SITE}`, LIVE_HOST), "");
  assert.equal(otherSite("", LIVE_HOST), "");
  assert.equal(otherSite("not a url", LIVE_HOST), "");
});

test("stats: a landing and an action as GoatCounter takes them", () => {
  const landing = new URL(countUrl(GOATCOUNTER, {
    path: `${SITE}#help`, title: "GP-200 Patch Manager", referrer: "https://example.com/", screen: "1920,1080,1", rnd: "abc",
  }));
  assert.equal(landing.origin, "https://donpark-gp200.goatcounter.com");
  assert.equal(landing.pathname, "/count");
  assert.deepEqual(Object.fromEntries(landing.searchParams), {
    p: `${SITE}#help`, t: "GP-200 Patch Manager", r: "https://example.com/", s: "1920,1080,1", rnd: "abc",
  });
  const action = new URL(countUrl(GOATCOUNTER, { path: "restore", event: true }));
  assert.deepEqual(Object.fromEntries(action.searchParams), { p: "restore", e: "true" }, "only what was given");
});

test("stats: a bad count is refused, not sent", () => {
  assert.throws(() => countUrl(GOATCOUNTER, { path: "" }), /no path/);
  assert.throws(() => countUrl(GOATCOUNTER, { path: "/restore", event: true }), /can't start with '\/'/);
  assert.throws(() => countUrl(GOATCOUNTER, { path: "help" }), /must start with '\/'/);
});

test("stats: the footer and Help link the public dashboard, in a new tab", () => {
  assert.equal(statsPage(), "https://donpark-gp200.goatcounter.com/");
  const html = read("index.html");
  const footer = html.slice(html.indexOf("<footer>"), html.indexOf("</footer>"));
  assert.match(footer, new RegExp(`<a href="${statsPage()}" target="_blank" rel="noopener">Stats</a>`));
  const help = html.slice(html.indexOf('<section id="scr-help"'), html.indexOf("</section>", html.indexOf('<section id="scr-help"')));
  assert.ok(help.includes(`href="${statsPage()}"`), "Help says what is counted and links the stats");
  assert.doesNotMatch(help, /sends nothing/, "Help no longer says the app sends nothing");
});

test("stats: the app counts a landing for every screen shown and each action once; the test page counts nothing", () => {
  const app = read("src/ui/app.js");
  assert.match(app, /import \{ makeStats \} from "\.\/stats\.js";/);
  assert.match(app, /makeStats\(log, \{ dev: DEV \}\)/, "?dev isn't counted");
  assert.match(app, /if \(shown !== state\.shown\) stats\.landing\(shown\);/, "show() counts each screen it shows");
  for (const a of ["connect", "backup"]) {
    assert.equal(app.split(`stats.action("${a}")`).length - 1, 1, `${a}: counted once`);
  }
  assert.equal(app.split("stats.action(kind)").length - 1, 1, "restore and template: counted once, in runWrite");
  assert.doesNotMatch(read("src/ui/testpage.js"), /stats/);
  assert.doesNotMatch(read("test.html"), /stats/i);
});
