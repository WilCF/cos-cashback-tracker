/* COS Cash-Back Tracker — content script
 * Runs on capitaloneshopping.com. Responsibilities:
 *  1) Scrape deals from the rendered DOM (resilient to styled-components hash class changes).
 *  2) Wait for client-side deals to finish rendering, then push a snapshot to the background worker.
 *  3) On request, re-scrape and return the latest snapshot.
 *  4) On request, scroll to + highlight (and optionally click) a specific deal so the user's
 *     own click mints the tracked cash-back redirect inside their logged-in session.
 */
(function () {
  "use strict";

  const norm = (s) => (s || "").toString().toLowerCase().replace(/\s+/g, " ").trim();

  // ---- Scraper -------------------------------------------------------------
  function parseDeals() {
    const containers = Array.from(document.querySelectorAll("[data-test-merchant-name]"));
    const deals = [];
    containers.forEach((el, idx) => {
      const merchant = (el.getAttribute("data-test-merchant-name") || "").trim();
      if (!merchant) return;
      const category = (el.getAttribute("data-test-category-name") || "").trim();

      // Merchant domain from the logo image URL (…/logos?domain=ebay.com…)
      let domain = null;
      const imgs = el.querySelectorAll("img");
      for (const img of imgs) {
        const m = (img.getAttribute("src") || "").match(/logos\?domain=([a-z0-9.\-]+)/i);
        if (m) { domain = m[1].toLowerCase(); break; }
      }

      const text = (el.textContent || "").replace(/\s+/g, " ").trim();

      // "earn 7% back" / "up to 51% back" / "Now 45% back" — take the max in this card.
      const pcts = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*%\s*back/gi)).map((m) => parseFloat(m[1]));
      const pct = pcts.length ? Math.max(...pcts) : null;
      if (pct === null) return; // spec: track % cash back only

      // Title (offer/product name). Prefer the styled Title node; fall back gracefully.
      let title = "";
      const tEl =
        el.querySelector('[class*="styled__Title"]') ||
        el.querySelector('[class*="Title-sc"]');
      if (tEl) title = tEl.textContent || "";
      if (!norm(title)) {
        const mn = el.querySelector('[data-testid="deal-item-merchant-name"]');
        if (mn && mn.nextElementSibling) title = mn.nextElementSibling.textContent || "";
      }
      title = (title || "").replace(/\s+/g, " ").trim().slice(0, 160);

      // Price (first $ amount that isn't the "$1,000 max" cap, best-effort)
      let price = null;
      const priceEl = el.querySelector('[class*="text-2xl"]');
      if (priceEl) {
        const pm = (priceEl.textContent || "").match(/\$\d[\d,]*(?:\.\d{2})?/);
        if (pm) price = pm[0];
      }
      if (!price) {
        const pm = text.match(/\$\d[\d,]*(?:\.\d{2})?/);
        if (pm && !/max/i.test(text.slice(Math.max(0, pm.index - 6), pm.index))) price = pm[0];
      }

      deals.push({ merchant, category, domain, pct, title, price, index: idx });
    });
    return deals;
  }

  function sendSnapshot() {
    let deals = [];
    try { deals = parseDeals(); } catch (e) { /* ignore parse errors */ }
    try {
      chrome.runtime.sendMessage({
        type: "snapshot",
        deals,
        url: location.href,
        ts: Date.now(),
      });
    } catch (e) { /* extension context invalidated — ignore */ }
  }

  // Deals render client-side; wait until the count is stable before snapshotting.
  function waitThenSnapshot() {
    let lastCount = -1, stable = 0, tries = 0;
    const tick = () => {
      const c = document.querySelectorAll("[data-test-merchant-name]").length;
      if (c > 0 && c === lastCount) stable++; else stable = 0;
      lastCount = c;
      tries++;
      if ((c > 0 && stable >= 3) || tries > 40) sendSnapshot();
      else setTimeout(tick, 400);
    };
    setTimeout(tick, 600);
  }

  // ---- Jump to deal --------------------------------------------------------
  function ensureHighlightStyle() {
    if (document.getElementById("cos-tracker-style")) return;
    const st = document.createElement("style");
    st.id = "cos-tracker-style";
    st.textContent = `
      .cos-tracker-flash {
        outline: 3px solid #2dd48c !important;
        outline-offset: 3px !important;
        border-radius: 10px !important;
        box-shadow: 0 0 0 6px rgba(45,212,140,.25), 0 0 28px rgba(45,212,140,.5) !important;
        animation: cosTrackerPulse 1s ease-in-out 3 !important;
        scroll-margin: 120px;
      }
      @keyframes cosTrackerPulse {
        0%,100% { box-shadow: 0 0 0 6px rgba(45,212,140,.18), 0 0 22px rgba(45,212,140,.35) !important; }
        50%     { box-shadow: 0 0 0 10px rgba(45,212,140,.35), 0 0 40px rgba(45,212,140,.7) !important; }
      }`;
    document.documentElement.appendChild(st);
  }

  function findDeal({ merchant, title, index }) {
    const items = Array.from(document.querySelectorAll("[data-test-merchant-name]"));
    const cands = items.filter((el) => norm(el.getAttribute("data-test-merchant-name")) === norm(merchant));
    const nt = norm(title);
    if (nt) {
      const key = nt.slice(0, 40);
      const exact = cands.find((el) => norm(el.textContent).includes(key));
      if (exact) return exact;
    }
    if (cands.length) return cands[0];
    if (index != null && items[index]) return items[index];
    return null;
  }

  function jumpToDeal(deal, autoClick) {
    const el = findDeal(deal);
    if (!el) return { found: false };
    ensureHighlightStyle();
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("cos-tracker-flash");
    setTimeout(() => el.classList.remove("cos-tracker-flash"), 4200);
    if (autoClick) {
      const btn = el.querySelector("button") || el;
      setTimeout(() => { try { btn.click(); } catch (e) {} }, 700);
    }
    return { found: true };
  }

  // ---- Messaging -----------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "getSnapshot") {
      let deals = [];
      try { deals = parseDeals(); } catch (e) {}
      sendResponse({ deals, url: location.href, ts: Date.now() });
      return true;
    }
    if (msg.type === "jumpToDeal") {
      sendResponse(jumpToDeal(msg.deal || {}, !!msg.autoClick));
      return true;
    }
  });

  // Kick off a snapshot on load.
  waitThenSnapshot();
})();
