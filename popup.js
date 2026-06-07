"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const msg = (type, data) => new Promise((res) => chrome.runtime.sendMessage(Object.assign({ type }, data), res));
const norm = (s) => (s || "").toString().toLowerCase().replace(/\s+/g, " ").trim();
const logoUrl = (d) => d ? `https://images.capitaloneshopping.com/api/v1/logos?domain=${encodeURIComponent(d)}&width=120&type=cropped&fallback=true` : "";

let state = { settings: {}, watchlist: [], snapshot: { deals: [], ts: 0 } };

// ---- tabs ------------------------------------------------------------------
$$(".tab").forEach((t) => t.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.remove("active"));
  $$(".panel").forEach((x) => x.classList.remove("active"));
  t.classList.add("active");
  $("#" + t.dataset.tab).classList.add("active");
}));

// ---- init ------------------------------------------------------------------
async function init() {
  state = await msg("getState");
  renderStatus();
  renderDeals();
  renderWatchlist();
  fillSettings();
}

function renderStatus() {
  const deals = (state.snapshot.deals || []).filter((d) => typeof d.pct === "number");
  const ts = state.snapshot.ts;
  const el = $("#status");
  if (!ts || !deals.length) { el.textContent = "No data yet — open capitaloneshopping.com"; return; }

  const mins = Math.round((Date.now() - ts) / 60000);
  const ago = mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;

  // The deals list already sorts highest-% first, so the header just reports watchlist status.
  const wl = state.watchlist || [];
  if (wl.length) {
    let hits = 0;
    for (const w of wl) {
      if (!w || !w.merchant) continue;
      const wn = norm(w.merchant);
      const hit = deals.some((d) => {
        const k = norm(d.merchant);
        return (k === wn || (wn.length >= 3 && k.includes(wn))) && d.pct >= Number(w.threshold);
      });
      if (hit) hits++;
    }
    el.textContent = `${hits > 0 ? "⚡ " : ""}${hits}/${wl.length} watched hit · ${ago}`;
  } else {
    el.textContent = `No watchlist yet · ${ago}`;
  }
}

// ---- deals -----------------------------------------------------------------
function groupByMerchant(deals) {
  const map = {};
  for (const d of deals) {
    if (typeof d.pct !== "number") continue;
    const k = norm(d.merchant);
    if (!map[k]) map[k] = { merchant: d.merchant, domain: d.domain, max: d.pct, deals: [] };
    map[k].deals.push(d);
    if (d.pct > map[k].max) map[k].max = d.pct;
    if (!map[k].domain && d.domain) map[k].domain = d.domain;
  }
  return Object.values(map).map((g) => {
    g.deals.sort((a, b) => b.pct - a.pct);
    return g;
  }).sort((a, b) => b.max - a.max);
}

function renderDeals() {
  const q = norm($("#search").value);
  const groups = groupByMerchant(state.snapshot.deals || []).filter((g) => {
    if (!q) return true;
    if (norm(g.merchant).includes(q)) return true;
    return g.deals.some((d) => norm(d.title).includes(q));
  });
  const list = $("#dealList");
  const empty = $("#dealsEmpty");
  list.innerHTML = "";
  if (!groups.length) {
    empty.classList.remove("hidden");
    empty.textContent = (state.snapshot.deals || []).length
      ? "No stores match your filter."
      : "No deals captured yet. Open capitaloneshopping.com (logged in) and they'll appear here, or hit ⟳ to refresh.";
    return;
  }
  empty.classList.add("hidden");

  for (const g of groups) {
    const card = document.createElement("div");
    card.className = "card";
    const dealsHtml = g.deals.map((d, i) => `
      <div class="deal">
        <div class="pct">${d.pct}%</div>
        <div class="info">
          <div>${escapeHtml(d.title || "(offer)")}</div>
          <div>${d.price ? `<span class="price">${escapeHtml(d.price)}</span> · ` : ""}<span class="cat">${escapeHtml(d.category || "")}</span></div>
        </div>
        <button class="jump" data-merchant="${escapeAttr(g.merchant)}" data-title="${escapeAttr(d.title || "")}" data-index="${d.index}">Jump →</button>
      </div>`).join("");
    card.innerHTML = `
      <div class="head">
        ${g.domain ? `<img src="${logoUrl(g.domain)}" alt="" onerror="this.style.display='none'">` : `<div class="logo" style="width:26px;height:26px;background:#eef3f5;color:#88979e">${escapeHtml((g.merchant||"?")[0])}</div>`}
        <div class="mname">${escapeHtml(g.merchant)}</div>
        <div class="badge">${g.max}%<small>top${g.deals.length > 1 ? ` · ${g.deals.length} deals` : ""}</small></div>
        <span class="chev">▶</span>
      </div>
      <div class="deals-sub">${dealsHtml}</div>`;
    card.querySelector(".head").addEventListener("click", () => card.classList.toggle("open"));
    card.querySelectorAll(".jump").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      doJump({ merchant: b.dataset.merchant, title: b.dataset.title, index: Number(b.dataset.index) });
    }));
    list.appendChild(card);
  }
}

async function doJump(deal) {
  toast("Jumping to deal…");
  const res = await msg("jumpToDeal", { deal });
  if (res && res.found) toast("Found it — highlighted on the page ✦");
  else if (res && res.opened) toast(res.found ? "Opened & highlighted ✦" : "Opened COS — couldn't pinpoint it; scroll to the store.");
  else toast((res && res.note) || "Couldn't locate that deal. Try ⟳ Refresh.");
}

$("#search").addEventListener("input", renderDeals);
$("#refreshBtn").addEventListener("click", async () => {
  $("#status").textContent = "Refreshing…";
  const r = await msg("refreshNow");
  if (r && r.snapshot) state.snapshot = r.snapshot;
  renderStatus(); renderDeals(); renderWatchlist();
  toast("Refreshed");
});

// ---- watchlist -------------------------------------------------------------
function renderWatchlist() {
  // datalist of known merchants
  const dl = $("#merchantList");
  const merchants = Array.from(new Set((state.snapshot.deals || []).map((d) => d.merchant))).sort();
  dl.innerHTML = merchants.map((m) => `<option value="${escapeAttr(m)}">`).join("");

  const list = $("#watchList");
  const empty = $("#watchEmpty");
  list.innerHTML = "";
  if (!state.watchlist.length) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  state.watchlist.forEach((w, i) => {
    const row = document.createElement("div");
    row.className = "watchitem";
    row.innerHTML = `<span class="wm">${escapeHtml(w.merchant)}</span><span class="wt">≥ ${w.threshold}%</span><button class="del" title="Remove">✕</button>`;
    row.querySelector(".del").addEventListener("click", async () => {
      state.watchlist.splice(i, 1);
      await msg("saveWatchlist", { watchlist: state.watchlist });
      renderWatchlist();
    });
    list.appendChild(row);
  });
}

$("#addWatch").addEventListener("click", async () => {
  const merchant = $("#watchMerchant").value.trim();
  const threshold = parseFloat($("#watchPct").value);
  if (!merchant || !(threshold > 0)) { toast("Enter a store and a % > 0"); return; }
  const k = norm(merchant);
  const existing = state.watchlist.find((w) => norm(w.merchant) === k);
  if (existing) existing.threshold = threshold;
  else state.watchlist.push({ merchant, threshold });
  await msg("saveWatchlist", { watchlist: state.watchlist });
  $("#watchMerchant").value = "";
  renderWatchlist();
  toast(`Watching ${merchant} ≥ ${threshold}%`);
});

// ---- settings --------------------------------------------------------------
function fillSettings() {
  const s = state.settings;
  $("#setEmail").value = s.email || "";
  $("#setGlobal").value = s.globalThreshold;
  $("#setNotifyMode").value = s.notifyMode || "new";
  $("#setBg").checked = !!s.backgroundRefresh;
  $("#setAutoClick").checked = !!s.autoClick;
  $("#setEnabled").checked = !!s.enabled;
  $("#setRelay").value = s.relayUrl || "";
}

$("#saveSettings").addEventListener("click", async () => {
  const settings = {
    email: $("#setEmail").value.trim(),
    globalThreshold: parseFloat($("#setGlobal").value) || 50,
    notifyMode: $("#setNotifyMode").value,
    backgroundRefresh: $("#setBg").checked,
    autoClick: $("#setAutoClick").checked,
    enabled: $("#setEnabled").checked,
    relayUrl: $("#setRelay").value.trim(),
  };
  await msg("saveSettings", { settings });
  state.settings = Object.assign(state.settings, settings);
  setStatus("Saved ✓", "ok");
});

$("#testEmail").addEventListener("click", async () => {
  // save first so relay/email are current
  await msg("saveSettings", { settings: { email: $("#setEmail").value.trim(), relayUrl: $("#setRelay").value.trim() } });
  setStatus("Sending test email…");
  const r = await msg("testEmail");
  if (r && r.ok) setStatus("Test email sent — check your inbox ✓", "ok");
  else setStatus("Failed: " + ((r && r.error) || (r && r.body) || "check the relay URL"), "err");
});

$("#runNow").addEventListener("click", async () => {
  setStatus("Checking deals…");
  const r = await msg("runCheckNow");
  if (r) {
    state.snapshot = state.snapshot; // unchanged ref; refresh display below
    const nm = r.hits ? r.hits.length : 0;
    setStatus(`${r.count || 0} deals scanned · ${nm} match${nm === 1 ? "" : "es"}${r.sent ? " · email sent ✓" : nm ? " · (no email — see When to email)" : ""}`, nm ? "ok" : "");
    const fresh = await msg("getState"); state = fresh; renderStatus(); renderDeals(); renderWatchlist();
  }
});

function setStatus(t, cls) { const el = $("#setStatus"); el.textContent = t; el.className = "setstatus " + (cls || ""); }

// ---- utils -----------------------------------------------------------------
let toastTimer;
function toast(t) {
  const el = $("#toast"); el.textContent = t; el.classList.remove("hidden");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}
function escapeHtml(s) { return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, "&#39;"); }

init();
