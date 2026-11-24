# Ranch Cookies — Chrome extension

Hands your signed-in browser session to your Ranch agents, so `browser_play`
opens a site already logged in. No VNC, no passwords, no scripted logins that
break on 2FA.

You sign in to the site in your normal Chrome, click the Ranch icon, and the
site's cookies go to Ranch as a Playwright `storageState`.

## Install (dev)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → pick the `extension/` directory of this repo.
3. Pin **Ranch Cookies** to the toolbar.

After pulling a new version, press the reload arrow on the extension's card.

## Connect

Open your Ranch console in a tab — the app (`https://ranch.cleanslice.org`) or
the admin console — and click the icon. The console advertises its API
(`<meta name="ranch-api-url">`) and names itself (`<meta name="ranch-console">`),
so the popup offers **Connect** in one click.

The popup trusts a page's API address only when it is on the page's own site
and over https (a local stack aside), and shows the API host it will connect
to — any page could carry that meta.

On any other page the popup asks for the **Ranch address**: the console you
sign in to. The API address is filled in for you (`api.` of the domain,
`admin.` dropped). For a local stack open **API address** and type it — there
the API has its own port, e.g. `http://localhost:3000`.

## How it signs in

Since CLEAN-236 each console keeps its own HttpOnly session cookie on the API
host — `ranch_session_app` and `ranch_session_admin` — and holds its access
token in memory only. The extension borrows that sign-in the way the console
renews it: `POST /auth/refresh` with `X-Ranch-Console`, the app's session
first, then the admin's. Chrome sends the API host's cookies with the
extension's request because the extension has host permission for it. A
refresh does not rotate the session secret, so the console tab stays signed
in, and signing out of the console signs the extension out too.

The access token lives in the popup's memory only. Stored in
`chrome.storage.local`: the Ranch and API addresses, the long-lived
`integration:cookies` token for "All my agents", the integration catalogue
(refreshed daily) and the last label per site.

If neither console is signed in, the popup offers **Open sign-in**.

## Use

1. Open the site you want your agents to use and sign in to it.
2. Click the Ranch icon. The site, its cookie count and — for a known service —
   the integration it belongs to are shown at the top.
3. Check the **account label** — a name for this account, so one site can
   hold several (e.g. `business`). It's guessed from the page title and
   remembered per site.
4. Choose **who gets the cookies**:
   - **All my agents** — saved to your integrations; every agent you use can
     sign in with it. The site must be a catalogue service.
   - **Specific agents** — tick the agents. Works for any site. The cookies
     land in each agent's browser store under *your* chat identity (the Owner
     is `admin`, anyone else their account id), decided by the API — nobody
     writes into another person's browser state.
5. **Send**. The agent signs in with `browser_play(profile: "<service>:<label>")`
   for a catalogue service, or `browser_play(profile: "<label>")` otherwise.

Who may send what (CLEAN-243): **Specific agents** is open to every signed-in
role, for the agents the person reaches. **All my agents** is an Owner's or
Admin's: the runtime resolves an integration profile across every account,
so a User's import would be the session any agent signs in with.

## What's not sent

- **localStorage** — the runtime restores cookies only.
- Cookies of other sites. The popup reads the cookies sent to the open page
  (parent domains included, where sign-ins like `.google.com` live) and those
  of the site's other subdomains.

## Look

The popup wears the app console's theme: the plum surfaces, copper accent and
Geist of `app/slices/setup/theme/assets/themes/default.css`, and the orbit
mark of `app/public/landing/brand/`. Change the theme there first.
