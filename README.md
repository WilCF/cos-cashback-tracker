# COS Cash-Back Tracker

A Chrome, Edge, and Firefox extension that reads the cash-back **% deals on Capital One Shopping** while you're logged in, lets you **filter by store** to find the highest % on offer, **jumps you straight to the deal** (so your click is credited), and emails you a **once-a-day digest** when a store you're watching hits the % you're waiting for.

It answers one question fast: *"What's the best cash-back % for this store right now — and ping me when it crosses my threshold."*

> **Why an extension and not a website?** Capital One Shopping is behind a login and renders its deals with JavaScript, and browsers block other sites from reading your logged-in session (CORS + cross-site cookies). Only code running *inside* the Capital One Shopping tab can read those deals — which is exactly what this extension does. No password or credentials are ever stored.

> **Independent project** — not affiliated with, endorsed by, or sponsored by Capital One. "Capital One Shopping" is a trademark of its respective owner.

---

## Features

- **Filter by store** — search any store on the page and see its deals instantly.
- **Top % per store** — shows the highest % across *all* of a store's deals, ignoring category.
- **Jump to deal** — focuses the Capital One Shopping tab, scrolls to the exact deal, and highlights it so you click "Get this Deal" yourself and your cash back is credited. (Optional auto-click toggle.)
- **Watchlist with thresholds** — e.g. `eBay ≥ 15%`. You're emailed only when it's met; silence otherwise.
- **Daily digest of big deals** — also emails anything `≥ 50%` (configurable) so you catch rare jumps without watching for them.
- **% cash back only** — flat "$X back" offers are ignored by design.
- **Silent daily refresh** — once a day it briefly opens Capital One Shopping in a background tab so alerts stay current even on days you don't visit (toggleable; needs the browser open at some point that day).
- **Email from your own Gmail** — via a tiny Google Apps Script relay. No server, no API keys, nothing stored in the cloud.
- **Desktop notifications** — works fully even before you set up email.

---

## Install

Works in **Google Chrome** and **Microsoft Edge** (Chromium-based, loaded from the repo root), and in **Firefox** via the separate `firefox/` build (Firefox needs a different background type).

### 1. Get the files onto your computer

**Option A — Git:**
```bash
git clone https://github.com/WilCF/cos-cashback-tracker.git
```

**Option B — No Git:** on this repo's page, click the green **Code** button → **Download ZIP**, then unzip it.

> Keep the folder somewhere permanent (e.g. `Documents`). The browser loads the extension from this folder every launch — if you move or delete it, the extension breaks.

### 2. Load the extension

**In Chrome**
1. Open `chrome://extensions`
2. Turn on **Developer mode** (toggle, top-right)
3. Click **Load unpacked** and select the folder that contains `manifest.json`
4. Click the puzzle-piece icon in the toolbar and **pin** "COS Cash-Back Tracker"

**In Edge**
1. Open `edge://extensions`
2. Turn on **Developer mode** (toggle, bottom-left)
3. Click **Load unpacked** and select the folder that contains `manifest.json`
4. Click the extensions (puzzle-piece) icon in the toolbar and **pin** it

**In Firefox** (Linux or any OS)

Firefox uses the prebuilt `firefox/` folder (it needs an event-page background instead of a service worker). If you edited any shared files, regenerate it first with `bash build-firefox.sh` — otherwise it's already committed and ready.

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select **`firefox/manifest.json`**
4. The **%** icon appears in the toolbar.

> **Heads-up:** on stable Firefox a temporary add-on is removed when you **restart** Firefox — just repeat steps 1–3 to reload it. Making it permanent requires signing via [Mozilla AMO](https://addons.mozilla.org/developers/) or using Firefox Developer Edition / ESR with signature enforcement off.

### 3. First run
Open **https://capitaloneshopping.com/** and log in. Wait a few seconds for the deals to load, then click the **%** toolbar icon. You'll see every store with its top %, a search box, and a **Jump →** button on each deal.

---

## Set up alerts

### Watchlist (per-store thresholds)
In the popup's **Watchlist** tab, type a store (it autocompletes from what's on the page), set a %, and click **Add**.

| Example | Meaning |
| --- | --- |
| `eBay ≥ 15%` | Email me when any eBay deal reaches 15% back |
| `Nike ≥ 8%` | Email me when Nike reaches 8% back |

### Settings
- **Global digest threshold** — email anything at or above this % (default **50%**).
- **When to email** — *Only when something new* (recommended, no repeats) or *Every day while active*.
- **Silent daily refresh** — on/off.
- **Auto-click on Jump** — off by default (highlight only).

### Email digest (optional, ~2 minutes)
The extension emails from your **own Gmail** using a small Google Apps Script web app — no server, no API keys.

1. Go to **https://script.google.com** → **New project**.
2. Delete the sample code and paste the entire contents of [`email_relay.gs`](./email_relay.gs).
3. Click **Deploy → New deployment → Web app**:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**, then **Authorize access** and allow it (it only sends mail as you).
5. Copy the Web app URL that ends in `/exec`.
6. In the popup: **Settings → Email setup**, paste the URL, **Save settings**, then **Send test email** and check your inbox.

Full details are also in [`SETUP.txt`](./SETUP.txt).

---

## How it works

- **`content.js`** runs on capitaloneshopping.com, reads each deal from the rendered page (keyed on stable `data-*` attributes and the "% back" text, not fragile styling), and sends a snapshot to the background worker. It also handles the scroll-and-highlight when you hit **Jump**.
- **`background.js`** stores the latest snapshot, runs a daily check (per-store watchlist + global threshold) with anti-spam de-duplication, fires desktop notifications, and POSTs the digest to your email relay.
- **`popup.*`** is the UI: filter by store, see top %, jump to deals, manage your watchlist, and configure settings.
- **`email_relay.gs`** is the optional Google Apps Script that turns a POST into an email from your Gmail.

Capital One Shopping mints the real, credited deal link only when you click — it isn't in the page beforehand — which is why the extension takes you to the deal instead of handing you a raw URL.

---

## Privacy & permissions

This is an independent tool — **not affiliated with, endorsed by, or sponsored by Capital One.** Full policy: **[PRIVACY.md](./PRIVACY.md)**.

- **No credentials are stored.** It works inside your already-logged-in browser session; it never sees your password.
- Your watchlist, settings, and email-relay URL are saved in your browser's local extension storage only. **No analytics, no tracking.**
- **Data leaves your browser only if you enable email** — and then only your matched deals plus the address you enter, sent over HTTPS to the Google Apps Script URL you create.
- Permissions requested and why:
  - `storage` — save your watchlist and settings
  - `alarms` — schedule the optional once-a-day check
  - `tabs` — open/close the optional background-refresh tab and focus the Capital One Shopping tab for Jump-to-deal
  - `notifications` — desktop alerts when a watched store hits your %
  - host access to `capitaloneshopping.com` (read the deals on the page you're viewing) and `script.google.com` (send your optional email digest)

---

## Troubleshooting

- **No deals show up** — make sure you're logged in to capitaloneshopping.com, give the page a few seconds, then click the **⟳** refresh button in the popup.
- **"Jump to deal" can't find it** — the deal rotated out of the current page; hit **⟳** to refresh.
- **No email** — confirm the relay was deployed with **Who has access: Anyone**, the `/exec` URL is pasted correctly, and try **Send test email**.
- **Deals stop appearing after a site update** — reload the Capital One Shopping page and click **⟳**. The scraper keys off stable data attributes, so it's designed to survive cosmetic changes.

---

## Limitations

- The silent daily refresh needs the browser open at some point each day (it can't run while the computer is off).
- It tracks **percentage** cash back only — flat "$X back" offers are intentionally excluded.
- It's loaded unpacked (developer mode), not from the Chrome/Edge stores.
- On Firefox (stable), it loads as a *temporary* add-on and is removed on restart — reload it via `about:debugging`. Permanent install needs Mozilla AMO signing or Firefox Developer Edition / ESR.

---

## Project structure

```
cos-cashback-tracker/
├── manifest.json          # MV3 manifest for Chrome + Edge (service worker)
├── manifest-firefox.json  # MV3 manifest for Firefox (event-page background + gecko id)
├── build-firefox.sh       # assembles the firefox/ folder from the shared files
├── content.js             # reads deals on capitaloneshopping.com; jump-to-deal
├── background.js          # daily check, rules, notifications, email relay POST (shared)
├── popup.html             # popup UI markup
├── popup.css              # popup styling
├── popup.js               # popup logic (filter, watchlist, settings)
├── email_relay.gs         # optional Google Apps Script email relay
├── icons/                 # toolbar icons (16 / 48 / 128)
├── firefox/               # ready-to-load Firefox build (load via about:debugging)
└── SETUP.txt              # plain-text setup guide
```

Chrome/Edge load from the **repo root**; Firefox loads from **`firefox/`**. Both share the same `content.js`, `background.js`, and `popup.*` — only the manifest differs, and `build-firefox.sh` keeps the two in sync.
