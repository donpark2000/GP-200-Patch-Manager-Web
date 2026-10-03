#!/usr/bin/env node
// Give each publish its own folder for the code (journal, Q7). GitHub Pages
// lets browsers reuse a file for 10 minutes, so right after a publish a
// returning visitor could get new files mixed with old cached ones. CI runs
// this on the assembled site: <site>/src moves to <site>/v/<stamp>/src, and
// the pages at the site root are pointed there. An old cached page then
// finds only its own files (cached) or nothing (the old folder is gone),
// never a newer file. The repo and localhost are unchanged.
//
//   node tools/stamp-site.js <site dir> <stamp>
//
// Afterwards every relative src/href in every root page must point into
// v/<stamp>/ at a file that exists; otherwise it lists each problem and
// exits 1, so CI doesn't publish. Prints how many references it checked.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REF = /\b(src|href)="([^"]*)"/g;
// Not files of this site: other sites, in-page links, the site root itself.
const isOutside = (url) => /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("#") || url.startsWith("//") ||
  url === "./" || url === "";

/**
 * @param {string} site the assembled site folder (holds the pages and src/)
 * @param {string} stamp the publish's name, e.g. the short commit hash
 * @returns {{folder: string, pages: number, refs: number, problems: string[]}}
 */
export function stampSite(site, stamp) {
  if (!/^[0-9A-Za-z_-]+$/.test(stamp)) return { folder: "", pages: 0, refs: 0, problems: [`bad stamp "${stamp}"`] };
  const folder = `v/${stamp}`;
  const problems = [];
  if (!existsSync(join(site, "src")) || !statSync(join(site, "src")).isDirectory()) {
    return { folder, pages: 0, refs: 0, problems: [`no src/ folder in ${site}`] };
  }
  if (existsSync(join(site, folder))) return { folder, pages: 0, refs: 0, problems: [`${folder} already exists`] };
  mkdirSync(join(site, folder), { recursive: true });
  renameSync(join(site, "src"), join(site, folder, "src"));

  const pages = readdirSync(site).filter((f) => f.endsWith(".html"));
  let refs = 0;
  for (const page of pages) {
    const path = join(site, page);
    const text = readFileSync(path, "utf8").replace(REF, (all, attr, url) =>
      url.startsWith("src/") ? `${attr}="${folder}/${url}"` : all);
    writeFileSync(path, text);
    for (const [, , url] of text.matchAll(REF)) {
      if (isOutside(url)) continue;
      refs++;
      const file = url.split(/[?#]/)[0];
      if (!file.startsWith(`${folder}/`)) problems.push(`${page}: "${url}" isn't in ${folder}/`);
      else if (!existsSync(join(site, file))) problems.push(`${page}: "${url}" doesn't exist`);
    }
  }
  if (!pages.length) problems.push(`no .html pages in ${site}`);
  if (pages.length && !refs) problems.push("no references to check: the pages load nothing from src/?");
  return { folder, pages: pages.length, refs, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [site, stamp] = process.argv.slice(2);
  if (!site || !stamp) {
    console.error("usage: node tools/stamp-site.js <site dir> <stamp>");
    process.exit(2);
  }
  const r = stampSite(site, stamp);
  if (r.problems.length) {
    console.error(`stamp-site: FAILED (${r.problems.length} problem(s)):`);
    for (const p of r.problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`stamp-site: code moved to ${r.folder}/; ${r.refs} reference(s) in ${r.pages} page(s) point there, all present`);
}
