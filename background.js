/* COS Cash-Back Tracker — background worker
 * Runs as a service worker in Chrome/Edge and as an event-page script in Firefox.
 * - Stores the latest deal snapshot (from passive visits + a silent daily refresh).
 * - Once a day, evaluates watchlist thresholds + a global "anything >= X%" rule.
 * - Emails a digest (Google Apps Script relay) only when there's something to report.
 * - Relays "jump to deal" requests to the COS tab's content script.
 *
 * Lifecycle note: both a Chrome MV3 service worker and a Firefox event page can be
 * torn down between events, so we never rely on a long-lived in-memory promise/timer.
 * A silent refresh stores the target tab id in chrome.storage; the snapshot message
 * (which itself wakes the worker) finishes the job — close the tab, run the daily eval.
 */
"use strict";

const DEFAULTS = {
  email: "",                                      // user enters their own address; no personal data baked into the code
  relayUrl: "",                                   // Google Apps Script /exec URL (optional)
  dealsUrl: "https://capitaloneshopping.com/",    // logged-in deals dashboard
  globalThreshold: 50,                            // digest anything >= this %
  backgroundRefresh: false,                       // OFF by default (opt-in); background behavior must be opt-in per store policies
  autoClick: false,                               // jump-to-deal also clicks the deal
  notifyMode: "new",                              // 'new' = only when something new; 'daily' = every day while active
  enabled: true,
};

const REFRESH_INTERVAL_MS = 20 * 60 * 60 * 1000;  // don't background-refresh more than ~once/20h
const NEW_WINDOW_DAYS = 3;                         // in 'new' mode, suppress a sig seen within N days

// ---- storage helpers -------------------------------------------------------
const sget = (keys) => new Promise((r) => chrome.storage.local.get(keys, r));
const sset = (obj) => new Promise((r) => chrome.storage.local.set(obj, r));

async function getSettings() {
  const { settings } = await sget("settings");
  return Object.assign({}, DEFAULTS, settings || {});
}
async function getWatchlist() {
  const { watchlist } = await sget("watchlist");
  return Array.isArray(watchlist) ? watchlist : [];
}
async function getSnapshot() {
  const { snapshot } = await sget("snapshot");
  return snapshot || { ts: 0, url: "", deals: [] };
}
async function getNotifyState() {
  const { notifyState } = await sget("notifyState");
  return notifyState || { lastDigestDate: "", sigs: {} };
}

const norm = (s) => (s || "").toString().toLowerCase().replace(/\s+/g, " ").trim();
const todayStr = () => new Date().toISOString().slice(0, 10);

// ---- lifecycle -------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => { scheduleAlarm(); });
chrome.runtime.onStartup.addListener(() => { scheduleAlarm(); maybeRunDaily("startup"); });

function scheduleAlarm() {
  // Fire every 3h so we catch a window where the browser is open; the digest is capped to 1/day.
  chrome.alarms.create("cosDaily", { periodInMinutes: 180, delayInMinutes: 1 });
}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "cosDaily") maybeRunDaily("alarm");
  else if (a.name === "refreshCleanup") cleanupRefresh();
});

// ---- message intake --------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "snapshot") {
    handleSnapshot(msg, sender);
    return; // fire-and-forget
  }
  if (msg.type === "getState") {
    (async () => sendResponse({
      settings: await getSettings(),
      watchlist: await getWatchlist(),
      snapshot: await getSnapshot(),
      notifyState: await getNotifyState(),
    }))();
    return true;
  }
  if (msg.type === "saveSettings") {
    (async () => { await sset({ settings: Object.assign(await getSettings(), msg.settings || {}) }); scheduleAlarm(); sendResponse({ ok: true }); })();
    return true;
  }
  if (msg.type === "saveWatchlist") {
    (async () => { await sset({ watchlist: msg.watchlist || [] }); sendResponse({ ok: true }); })();
    return true;
  }
  if (msg.type === "refreshNow") {
    (async () => { await startRefresh({ dailyEval: false }); sendResponse({ snapshot: await getSnapshot() }); })();
    return true;
  }
  if (msg.type === "runCheckNow") {
    (async () => { await startRefresh({ dailyEval: false }); sendResponse(await evaluateAndMaybeEmail(true)); })();
    return true;
  }
  if (msg.type === "jumpToDeal") {
    (async () => sendResponse(await jumpToDeal(msg.deal || {})))();
    return true;
  }
  if (msg.type === "testEmail") {
    (async () => sendResponse(await sendTestEmail()))();
    return true;
  }
});

async function handleSnapshot(msg, sender) {
  const snap = { ts: msg.ts || Date.now(), url: msg.url || "", deals: msg.deals || [] };
  await sset({ snapshot: snap });
  const { refreshState } = await sget("refreshState");
  // Only act if this snapshot came from a background tab WE opened for a refresh.
  if (refreshState && sender && sender.tab && sender.tab.id === refreshState.tabId && snap.deals.length) {
    await sset({ lastRefreshTs: Date.now(), refreshState: null });
    try { chrome.alarms.clear("refreshCleanup"); } catch (e) {}
    try { chrome.tabs.remove(refreshState.tabId); } catch (e) {}
    if (refreshState.dailyEval) await evaluateAndMaybeEmail(false);
  }
}

// ---- daily logic -----------------------------------------------------------
async function maybeRunDaily(reason) {
  const s = await getSettings();
  if (!s.enabled) return;
  const { lastRefreshTs } = await sget("lastRefreshTs");
  const stale = !lastRefreshTs || (Date.now() - lastRefreshTs > REFRESH_INTERVAL_MS);
  if (s.backgroundRefresh && stale) {
    // Refresh first; evaluation runs when the fresh snapshot arrives (or inline if a COS tab is open).
    await startRefresh({ dailyEval: true });
  } else {
    await evaluateAndMaybeEmail(false);
  }
}

function evaluate(snap, s, watchlist, ns) {
  const deals = (snap.deals || []).filter((d) => typeof d.pct === "number");
  const bestByMerchant = {};
  for (const d of deals) {
    const k = norm(d.merchant);
    if (!bestByMerchant[k] || d.pct > bestByMerchant[k].pct) bestByMerchant[k] = d;
  }
  const hits = [];
  const usedMerchants = new Set();

  for (const w of watchlist) {
    if (!w || !w.merchant) continue;
    const wn = norm(w.merchant);
    const matchKey = Object.keys(bestByMerchant).find((k) => k === wn || (wn.length >= 3 && k.includes(wn)));
    if (!matchKey) continue;
    const best = bestByMerchant[matchKey];
    if (best.pct >= Number(w.threshold)) { hits.push(mkHit(best, "watch", w.threshold)); usedMerchants.add(matchKey); }
  }
  for (const k of Object.keys(bestByMerchant)) {
    if (usedMerchants.has(k)) continue;
    const best = bestByMerchant[k];
    if (best.pct >= Number(s.globalThreshold)) hits.push(mkHit(best, "global", s.globalThreshold));
  }

  const recent = (sig) => {
    const d = ns.sigs && ns.sigs[sig];
    if (!d) return false;
    return (Date.now() - new Date(d).getTime()) / 86400000 < NEW_WINDOW_DAYS;
  };
  hits.forEach((h) => { h.isNew = !recent(h.sig); });
  hits.sort((a, b) => b.pct - a.pct);
  return { hits, anyNew: hits.some((h) => h.isNew) };
}

function mkHit(deal, kind, threshold) {
  return {
    merchant: deal.merchant, domain: deal.domain, pct: deal.pct,
    title: deal.title, price: deal.price, category: deal.category, index: deal.index,
    kind, threshold: Number(threshold),
    sig: norm(deal.merchant) + "|" + deal.pct,
  };
}

async function evaluateAndMaybeEmail(force) {
  const s = await getSettings();
  if (!s.enabled && !force) return { hits: [], anyNew: false, sent: false, count: 0 };
  const watchlist = await getWatchlist();
  const snap = await getSnapshot();
  const ns = await getNotifyState();
  const { hits, anyNew } = evaluate(snap, s, watchlist, ns);

  const alreadyToday = ns.lastDigestDate === todayStr();
  let sendNow = false;
  if (hits.length) {
    if (s.notifyMode === "daily") sendNow = force || !alreadyToday;
    else sendNow = anyNew;
  }
  if (force && hits.length) sendNow = true;

  let sent = false;
  if (sendNow) {
    const sigs = Object.assign({}, ns.sigs);
    hits.forEach((h) => { sigs[h.sig] = todayStr(); });
    await sset({ notifyState: { lastDigestDate: todayStr(), sigs } });
    notify(hits);
    if (s.relayUrl && s.email) {
      const res = await sendEmail(s, hits).catch(() => ({ ok: false }));
      sent = !!(res && res.ok);
    }
  }
  return { hits, anyNew, sent, snapshotTs: snap.ts, count: (snap.deals || []).length };
}

// ---- refresh (storage-backed, lifecycle-safe) ------------------------------
function queryCosTabs() {
  return new Promise((r) => chrome.tabs.query({ url: ["https://capitaloneshopping.com/*", "https://*.capitaloneshopping.com/*"] }, (t) => r(t || [])));
}
function requestSnapshotFromTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "getSnapshot" }, (resp) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(resp);
    });
  });
}

/* If a COS tab is already open, scrape it inline (fast, no suspension risk) and, for a
 * daily check, evaluate right away. Otherwise open a background tab and record its id in
 * storage; handleSnapshot() finishes when the tab reports in. */
async function startRefresh({ dailyEval }) {
  const cos = await queryCosTabs();
  if (cos.length) {
    try {
      const resp = await requestSnapshotFromTab(cos[0].id);
      if (resp && resp.deals && resp.deals.length) {
        await sset({ snapshot: { ts: Date.now(), url: cos[0].url || "", deals: resp.deals }, lastRefreshTs: Date.now() });
      }
    } catch (e) { /* content script not ready — fall through */ }
    if (dailyEval) await evaluateAndMaybeEmail(false);
    return { via: "existing" };
  }
  const s = await getSettings();
  const tab = await new Promise((r) => chrome.tabs.create({ url: s.dealsUrl, active: false }, r));
  if (!tab) return { via: "failed" };
  await sset({ refreshState: { tabId: tab.id, startedAt: Date.now(), dailyEval: !!dailyEval } });
  chrome.alarms.create("refreshCleanup", { delayInMinutes: 1 }); // safety net if no snapshot arrives
  return { via: "opened", tabId: tab.id };
}

async function cleanupRefresh() {
  const { refreshState } = await sget("refreshState");
  if (!refreshState) return;
  try { chrome.tabs.remove(refreshState.tabId); } catch (e) {}
  await sset({ refreshState: null });
  if (refreshState.dailyEval) await evaluateAndMaybeEmail(false); // evaluate on whatever we have
}

// ---- jump to deal ----------------------------------------------------------
async function jumpToDeal(deal) {
  const s = await getSettings();
  const cos = await queryCosTabs();
  if (cos.length) {
    const tab = cos[0];
    try { chrome.tabs.update(tab.id, { active: true }); chrome.windows.update(tab.windowId, { focused: true }); } catch (e) {}
    const res = await sendJump(tab.id, deal, s.autoClick).catch(() => ({ found: false }));
    if (res && res.found) return { ok: true, found: true };
    return { ok: true, found: false, note: "Deal not on the current page — it may have rotated out. Try Refresh." };
  }
  return new Promise((resolve) => {
    chrome.tabs.create({ url: s.dealsUrl, active: true }, (tab) => {
      const onUpdated = (tabId, info) => {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          setTimeout(async () => {
            const res = await sendJump(tab.id, deal, s.autoClick).catch(() => ({ found: false }));
            resolve({ ok: true, opened: true, found: !!(res && res.found) });
          }, 4500);
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  });
}
function sendJump(tabId, deal, autoClick) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "jumpToDeal", deal, autoClick }, (resp) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(resp || { found: false });
    });
  });
}

// ---- notifications + email -------------------------------------------------
function notify(hits) {
  try {
    const top = hits[0];
    const more = hits.length > 1 ? ` (+${hits.length - 1} more)` : "";
    chrome.notifications.create("cos-" + Date.now(), {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `Cash-back alert: ${top.merchant} ${top.pct}%`,
      message: `${top.pct}% back at ${top.merchant}${more}. Open the tracker to jump to it.`,
      priority: 2,
    });
  } catch (e) {}
}

function digestHtml(hits, settings) {
  const fresh = hits.filter((h) => h.isNew);
  const active = hits.filter((h) => !h.isNew);
  const row = (h) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:700;color:#0b3d52;font-size:15px;white-space:nowrap">${escape(h.merchant)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;color:#0a7d3c;font-weight:800;font-size:18px;text-align:right;white-space:nowrap">${h.pct}%</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;color:#444;font-size:13px">${escape(h.title || "")}${h.price ? ` &middot; <span style="color:#888">${escape(h.price)}</span>` : ""}<div style="color:#9aa;font-size:11px;margin-top:2px">${h.kind === "watch" ? `watchlist &ge; ${h.threshold}%` : `digest &ge; ${settings.globalThreshold}%`}</div></td>
    </tr>`;
  const section = (label, arr) => arr.length ? `
    <p style="margin:22px 0 6px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#888;font-weight:700">${label}</p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:10px;overflow:hidden">${arr.map(row).join("")}</table>` : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:600px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#004c6b,#0a7d3c);border-radius:14px;padding:20px 22px;color:#fff">
        <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.8">Capital One Shopping</div>
        <div style="font-size:22px;font-weight:800;margin-top:2px">Daily Cash-Back Digest</div>
        <div style="font-size:13px;opacity:.85;margin-top:4px">${new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})}</div>
      </div>
      ${section("New since your last email", fresh)}
      ${section("Still available", active)}
      <p style="margin:20px 0 6px;color:#555;font-size:13px;line-height:1.5">Open Capital One Shopping, then use the <b>COS Cash-Back Tracker</b> extension's <b>Jump to deal</b> button so your click is credited.</p>
      <a href="https://capitaloneshopping.com/" style="display:inline-block;margin-top:6px;background:#0a7d3c;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:9px;font-size:14px">Open Capital One Shopping &rarr;</a>
      <p style="margin-top:22px;color:#aab;font-size:11px">You're getting this because a store hit your threshold or a deal reached ${settings.globalThreshold}%+. Manage rules in the extension popup.</p>
    </div></body></html>`;
}
function escape(s){return (s||"").replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));}

function digestText(hits, settings){
  return "Capital One Shopping — Daily Cash-Back Digest\n\n" +
    hits.map((h)=>`${h.isNew?"[NEW] ":""}${h.merchant}: ${h.pct}% — ${h.title||""}${h.price?" ("+h.price+")":""} [${h.kind==="watch"?"watch >="+h.threshold+"%":"digest >="+settings.globalThreshold+"%"}]`).join("\n") +
    "\n\nOpen https://capitaloneshopping.com/ and use the tracker's Jump-to-deal button so your click is credited.";
}

async function sendEmail(settings, hits) {
  const payload = {
    to: settings.email,
    subject: `Cash-back: ${hits[0].merchant} ${hits[0].pct}%${hits.length>1?` +${hits.length-1} more`:""}`,
    html: digestHtml(hits, settings),
    text: digestText(hits, settings),
  };
  return postRelay(settings.relayUrl, payload);
}
async function sendTestEmail() {
  const s = await getSettings();
  if (!s.relayUrl) return { ok: false, error: "No email relay URL set. Add it in Settings." };
  if (!s.email) return { ok: false, error: "No email address set." };
  const sample = [
    { merchant: "eBay", pct: 14, title: "Test alert — sneakers (exclusive)", price: "$—", kind: "watch", threshold: 10, isNew: true, sig: "ebay|14" },
    { merchant: "Ancestry", pct: 70, title: "Test alert — 70% back", price: null, kind: "global", threshold: s.globalThreshold, isNew: false, sig: "ancestry|70" },
  ];
  return postRelay(s.relayUrl, {
    to: s.email, subject: "COS Tracker — test email",
    html: digestHtml(sample, s), text: digestText(sample, s),
  }).catch((e) => ({ ok: false, error: String(e) }));
}
async function postRelay(url, payload) {
  // text/plain avoids a CORS preflight; Apps Script reads e.postData.contents and JSON.parses it.
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
    redirect: "follow",
  });
  let body = "";
  try { body = await resp.text(); } catch (e) {}
  const ok = resp.ok && !/error/i.test(body.slice(0, 200));
  return { ok, status: resp.status, body: body.slice(0, 300) };
}
