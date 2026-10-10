// The site's usage stats on the page (DESIGN.md "Stats"): a count for each
// landing on a screen and for each action. What is counted and why:
// src/core/stats.js. Each count goes in the debug log ("Stats: ..."), sent
// or not.

import { actionEvent, GOATCOUNTER, landingPath, otherSite, shouldCount, countUrl } from "../core/stats.js";

/**
 * @param {{info: (msg: string) => void}} log the app's debug log
 * @param {{dev?: boolean}} [opts] dev: ?dev in the address (not counted)
 * @returns {{landing: (screen: string) => void, action: (name: string) => void}}
 */
export function makeStats(log, { dev = false } = {}) {
  const live = shouldCount({ hostname: location.hostname, webdriver: navigator.webdriver, dev });
  const why = navigator.webdriver ? "automated browser" : dev ? "?dev" : location.hostname || "a file";
  let first = true;

  function send(opts, what) {
    if (!live) {
      log.info(`Stats: not counted (${why}): ${what}`);
      return;
    }
    const img = new Image();
    img.onerror = () => log.info(`Stats: count not sent (blocked or offline): ${what}`);
    img.src = countUrl(GOATCOUNTER, { ...opts, rnd: Math.random().toString(36).slice(2, 8) });
    log.info(`Stats: counted ${what}`);
  }

  return {
    /** A screen was shown; the first landing also carries the referrer and screen size. */
    landing(screenName) {
      const path = landingPath(location.pathname, screenName);
      const extra = first
        ? { referrer: otherSite(document.referrer, location.hostname), screen: `${screen.width},${screen.height},${devicePixelRatio}` }
        : {};
      first = false;
      send({ path, title: document.title, ...extra }, path);
    },
    /** An action happened (connect, backup, restore, template). */
    action(name) {
      const event = actionEvent(name);
      send({ path: event, title: document.title, event: true }, event);
    },
  };
}
