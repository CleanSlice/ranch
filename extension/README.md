# Ranch Cookies — Chrome Extension

Sends cookies for the currently-open site to your Ranch agent so it can
drive logged-in browser automation (`browser_play`) without VNC.

## Why

The agent's `browser_play` tool runs Chromium with `storageState` — a JSON
file holding cookies + localStorage. Getting that JSON file used to mean
either logging in via noVNC (laggy, fingerprint-detectable) or scripting
the login flow (brittle, breaks on 2FA / CAPTCHA).

This extension cuts the cycle. You log in to the site **in your normal
Chrome**, click the extension icon, and the cookies flow to Ranch as
storageState. Next `browser_play` with that profile name is logged in.

## Install (dev)

1. Open `chrome://extensions`
2. Toggle **Developer mode** on
3. Click **Load unpacked** → pick the `ranch/extension/` directory in this
   repo
4. Pin the new "Ranch Cookies" icon to the toolbar

## Configure

The first popup ask for two things:

- **Ranch API URL** — e.g. `https://api.ranch.cleanslice.org` (prod) or
  `http://localhost:3333` (local dev).
- **Bearer token** — your Ranch JWT. Get it from the admin UI:
  `https://admin.ranch.cleanslice.org/browser` → **Connect via extension**.
  The token is scoped to your user and used only to forward cookies; we
  store it locally via `chrome.storage.local`, never in cloud sync.

## Use

1. Open the site you want the agent to drive (`instagram.com`,
   `paypal.com`, anything). Log in if you aren't already.
2. Click the Ranch icon.
3. Pick a profile name — the same string you'll pass as `profile` to
   `browser_play`. Examples: `instagram`, `instagram:miybot`,
   `paypal:business`.
4. Click **Send cookies**.

The agent now has the cookies. Run `browser_play(profile: "<that name>")`
and it'll be logged in.

## What's NOT sent

- **localStorage** — needs per-origin scripting to read; the storageState
  shape supports it but Ranch's runtime only restores cookies anyway.
- **Passwords / autofill data** — `chrome.cookies` doesn't surface those.
- **Cookies for any other site** — the popup only reads cookies for the
  currently-active tab's domain.

## Manifest permissions

| Permission | Used for |
|---|---|
| `cookies` | Reading the current tab's cookies (only on user click). |
| `storage` | Saving the API URL + token in `chrome.storage.local`. |
| `activeTab` | Identifying the current tab's domain. |
| `<all_urls>` host permission | Same — the cookies API matches by domain, which requires host access. |

No content scripts run on any page. No tracking, no analytics. Source is
~150 lines of plain JS — read it.
