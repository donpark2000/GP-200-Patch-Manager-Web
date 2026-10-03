// The published site: tools/stamp-site.js (a folder per publish, journal Q7)
// and the page's own links. Each test works in its own temp folder.

import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stampSite } from "../tools/stamp-site.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A temp site folder, removed after the test. */
function tempSite(t) {
  const dir = mkdtempSync(join(tmpdir(), "gp200-site-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The site as CI assembles it (both pages, as with "include test page"). */
function realSite(t) {
  const dir = tempSite(t);
  for (const f of ["index.html", "test.html", "src"]) cpSync(join(REPO, f), join(dir, f), { recursive: true });
  return dir;
}

function writeFiles(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
}

test("stamp-site: the real pages point into v/<stamp>/ and every file is there", (t) => {
  const site = realSite(t);
  const r = stampSite(site, "abc1234");
  assert.deepEqual(r.problems, []);
  assert.equal(r.pages, 2);
  assert.equal(r.refs, 4, "app.css, app.js, testpage.css, testpage.js");
  assert.equal(existsSync(join(site, "src")), false, "src/ moved, not copied");
  assert.equal(existsSync(join(site, "v/abc1234/src/core/slots.js")), true);
  const index = readFileSync(join(site, "index.html"), "utf8");
  assert.match(index, /<script type="module" src="v\/abc1234\/src\/ui\/app\.js"><\/script>/);
  assert.match(index, /href="v\/abc1234\/src\/ui\/app\.css"/);
  assert.match(index, /href="#home"/, "in-page links unchanged");
  assert.match(index, /href="https:\/\/gp200studio\.com\/"/, "other sites unchanged");
  assert.match(readFileSync(join(site, "test.html"), "utf8"), /href="\.\/"/, "the test page's link home unchanged");
});

test("stamp-site: a reference left outside the folder fails", (t) => {
  const site = tempSite(t);
  writeFiles(site, {
    "index.html": '<link href="src/a.css"><script src="lib/b.js"></script>',
    "src/a.css": "",
    "lib/b.js": "",
  });
  const r = stampSite(site, "abc1234");
  assert.equal(r.refs, 2);
  assert.deepEqual(r.problems, ['index.html: "lib/b.js" isn\'t in v/abc1234/']);
});

test("stamp-site: a missing file fails, naming it", (t) => {
  const site = realSite(t);
  unlinkSync(join(site, "src/ui/app.js"));
  const r = stampSite(site, "abc1234");
  assert.deepEqual(r.problems, ['index.html: "v/abc1234/src/ui/app.js" doesn\'t exist']);
});

test("stamp-site: no src/, no pages, nothing to check, or a bad stamp all fail", (t) => {
  assert.match(stampSite(tempSite(t), "abc1234").problems[0], /^no src\/ folder/);

  const noPages = tempSite(t);
  writeFiles(noPages, { "src/a.js": "" });
  assert.deepEqual(stampSite(noPages, "abc1234").problems, [`no .html pages in ${noPages}`]);

  const noRefs = tempSite(t);
  writeFiles(noRefs, { "index.html": '<a href="https://example.com/">x</a>', "src/a.js": "" });
  assert.match(stampSite(noRefs, "abc1234").problems[0], /^no references to check/);

  const bad = realSite(t);
  assert.deepEqual(stampSite(bad, "../x").problems, ['bad stamp "../x"']);
  assert.equal(existsSync(join(bad, "src")), true, "a bad stamp changes nothing");
});

test("index.html: every link to another site opens in a new tab", () => {
  const html = readFileSync(join(REPO, "index.html"), "utf8");
  const outside = [...html.matchAll(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>/g)];
  assert.ok(outside.length >= 4, `found ${outside.length} outside links`);
  for (const [tag, url] of outside) {
    assert.match(tag, /target="_blank"/, url);
    assert.match(tag, /rel="noopener"/, url);
  }
});

test("index.html: the title links home, and there is no Reconnect button", () => {
  const html = readFileSync(join(REPO, "index.html"), "utf8");
  assert.match(html, /<h1><a href="#home"[^>]*>GP-200 Patch Manager<\/a><\/h1>/);
  assert.doesNotMatch(html, /id="reconnect"/);
});
