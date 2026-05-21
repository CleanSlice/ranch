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

**Fastest path:** open your Ranch admin in a tab, then click the
extension icon. The admin page advertises its API URL via a
`<meta name="ranch-api-url">` tag, so the popup shows a **Use this site**
card — one click and you're connected (works on localhost too, no port
guessing). Manual entry below is the fallback when the popup is opened
on some other page.

Manual setup asks for two URLs:

- **Ranch admin URL** — e.g. `https://admin.ranch.cleanslice.org` (prod)
  or `http://localhost:3001` (local dev). The extension reads your login
  cookie from this origin.
- **Ranch API URL** — auto-filled by swapping the leading `admin.` host
  segment for `api.`. **For local dev you must edit it** — admin and API
  run on different ports (e.g. `http://localhost:3000`).

After that:

1. If you're not signed in to Ranch admin yet, the popup gives you a
   button to open the login page. Sign in there, come back, click
   "I've signed in — check again".
2. That's it — there is no separate agent-picker step. The popup mints
   an `integration:cookies`-scoped JWT server-side and stores it in
   `chrome.storage.local`. From now on you just open the popup and
   click **Send cookies**.

If API calls fail with a "Can't reach the Ranch API" banner, the API
URL is wrong — click **Disconnect** and re-enter it.

## Use

1. Open the site you want the agent to drive (`instagram.com`,
   `paypal.com`, anything). Log in if you aren't already.
2. Click the Ranch icon.
3. Type an **account label** — the friendly name for this account
   (e.g. `miybot`, `business`).
4. Choose **who gets the cookies**:
   - **All my agents** (default) — cookies land in your per-user
     integration store; every agent you run can use them. The site
     must be a known catalogue service.
   - **Specific agents** — tick the agents from the list; cookies go
     to each agent's own browser store. Works for any site, in or out
     of the catalogue.
5. Click **Send cookies**.

The agent now has the cookies. For a catalogue service the profile is
`<service>:<label>` (e.g. `instagram:miybot`); for an unlisted site it's
just the label. Run `browser_play(profile: "<that name>")` and it'll be
logged in.

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
