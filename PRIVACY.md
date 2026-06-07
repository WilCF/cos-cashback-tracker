# Privacy Policy — COS Cash-Back Tracker

_Last updated: 2026-06-07_

COS Cash-Back Tracker is an independent browser extension. It is **not affiliated with, endorsed by, or sponsored by Capital One.** This policy explains exactly what the extension does with data.

## What the extension reads
When you are on **capitaloneshopping.com**, the extension reads the cash-back deals shown on the page you are viewing (store name, percentage, product title, price) so it can let you filter by store, see the highest %, and jump to a deal. It only reads pages you visit while logged in yourself — it never logs in for you and never sees or stores your Capital One Shopping password.

## What is stored, and where
The following are stored **locally in your browser only** (via the extension's `storage` area) and never leave your device except as described in "What is transmitted":
- Your watchlist (stores and the % thresholds you set)
- Your settings (e.g. the global digest %, your chosen options)
- The most recent snapshot of deals read from the page
- The email address and relay URL you optionally enter

There is **no analytics, no tracking, no advertising, and no selling or sharing of data.**

## What is transmitted
The extension transmits data to a remote server **only if you turn on the optional email digest.** Email is **off until you create and enter a Google Apps Script "relay" URL of your own.** When enabled:
- The extension sends **only your matched deals and the email address you entered** to the Google Apps Script URL **you** created (which runs under your own Google account) so it can email the digest to you.
- Data is sent over HTTPS.
- Nothing is sent to the developer or to any third party other than the relay you set up.

If you never set up the email relay, the extension transmits nothing.

## Permissions and why they are needed
- **storage** — save your watchlist and settings locally.
- **alarms** — schedule the optional once-a-day check.
- **tabs** — open and close the optional background-refresh tab, and focus the Capital One Shopping tab when you use "Jump to deal."
- **notifications** — show a desktop alert when a watched store hits your %.
- Host access to **capitaloneshopping.com** — read the deals on the page you are viewing.
- Host access to **script.google.com** — deliver your optional email digest to the relay you configured.

## Your control
- The email digest and the silent daily background refresh are **off by default** and are opt-in.
- You can remove all stored data at any time by removing the extension.

## Contact
Questions about privacy: **cashbackapp@mwilstevens.com**
