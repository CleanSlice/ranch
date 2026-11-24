// Ranch Cookies popup. Screens: loading → setup → login → main, under the
// App / Admin tabs once a Ranch is connected.
//
// Signing in (CLEAN-243). Each console keeps its own HttpOnly session
// cookie on the API host — `ranch_session_app` and `ranch_session_admin`
// (CLEAN-236) — and holds its access token in memory only. The extension
// borrows the person's console sign-in the way the console itself renews
// it: `POST /auth/refresh` with credentials and `X-Ranch-Console`. Chrome
// sends the API host's cookies with an extension request because the
// extension has host permission for it. A refresh does not rotate the
// secret, so the console tab stays signed in.
//
// Which console's sign-in it uses is the person's pick, on the tabs: the
// app and the admin console may be two different people on one browser,
// and falling over to whichever is signed in sent cookies as the wrong one.
//
// The access token lives in this popup's memory and nowhere else. What is
// stored is the Ranch's addresses, the chosen console, the long-lived
// `integration:cookies` token for the "all my agents" push (with whose it
// is), the catalogue and the last labels.

const STORE_KEY = 'ranch-cookies:v3';
const LEGACY_STORE_KEY = 'ranch-cookies:v2';
const CONSOLES = ['app', 'admin'];
const CONSOLE_HEADER = 'X-Ranch-Console';
const CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000;
const PROD_CONSOLE = 'https://ranch.cleanslice.org';

const $ = (id) => document.getElementById(id);

/** The console session borrowed for this popup: `{ token, console, user }`. */
let session = null;
/** Agents fetched the first time "Specific agents" opens. */
let agentsCache = null;
/** Whether the API field was edited by hand — then it is left alone. */
let apiUrlEdited = false;

// ── persistence ──────────────────────────────────────────────────────

async function loadState() {
  const data = await chrome.storage.local.get([STORE_KEY, LEGACY_STORE_KEY]);
  const current = data[STORE_KEY];
  if (current && !current.consoleUrl) return current;
  if (current) {
    // 0.5.0 kept one console address; the tabs need both.
    const { consoleUrl, ...rest } = current;
    const migrated = { ...rest, consoles: withConsole(consolesOf(rest.apiUrl), consoleUrl) };
    await chrome.storage.local.set({ [STORE_KEY]: migrated });
    return migrated;
  }
  // 0.4 stored the admin URL and a token minted from the admin cookie.
  // Keep the addresses, drop the rest: the token is re-minted on sign-in.
  const legacy = data[LEGACY_STORE_KEY];
  if (!legacy?.adminUrl) return {};
  const apiUrl = legacy.apiUrl ?? deriveApiUrl(legacy.adminUrl);
  const migrated = {
    apiUrl,
    consoles: withConsole(consolesOf(apiUrl), legacy.adminUrl),
    lastAccountKeys: legacy.lastAccountKeys ?? {},
  };
  await chrome.storage.local.set({ [STORE_KEY]: migrated });
  await chrome.storage.local.remove(LEGACY_STORE_KEY);
  return migrated;
}

async function saveState(patch) {
  const merged = { ...(await loadState()), ...patch };
  await chrome.storage.local.set({ [STORE_KEY]: merged });
  return merged;
}

async function clearState() {
  await chrome.storage.local.remove([STORE_KEY, LEGACY_STORE_KEY]);
}

// ── addresses ────────────────────────────────────────────────────────

function normalize(raw) {
  const text = (raw ?? '').trim();
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return /^https?:$/.test(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

// A Ranch deploy serves the API on `api.` of the domain: the admin console
// is `admin.<domain>`, the app the domain itself (ranch.cleanslice.org ↔
// api.ranch.cleanslice.org). Localhost has no such rule — the API has its
// own port, and the person types it.
function deriveApiUrl(consoleOrigin) {
  try {
    const url = new URL(consoleOrigin);
    if (url.hostname === 'localhost' || /^[\d.]+$/.test(url.hostname)) {
      return consoleOrigin;
    }
    const host = url.hostname.startsWith('admin.')
      ? url.hostname.slice('admin.'.length)
      : url.hostname.replace(/^(app|www)\./, '');
    url.hostname = `api.${host}`;
    return url.origin;
  } catch {
    return consoleOrigin;
  }
}

/**
 * The two consoles of one Ranch, from its API address: `api.<domain>`
 * serves the app at `<domain>` and the admin console at `admin.<domain>`.
 * Empty for a local stack, where each console has a port of its own and is
 * learnt from its tab.
 */
function consolesOf(apiUrl) {
  try {
    const url = new URL(apiUrl);
    if (isLocal(url.hostname) || !url.hostname.startsWith('api.')) return {};
    const domain = url.hostname.slice('api.'.length);
    const at = (host) => {
      const u = new URL(url.origin);
      u.hostname = host;
      return u.origin;
    };
    return { app: at(domain), admin: at(`admin.${domain}`) };
  } catch {
    return {};
  }
}

/** Which console an address is, when nothing says: `admin.` is the admin's. */
function consoleOfUrl(origin) {
  try {
    return new URL(origin).hostname.startsWith('admin.') ? 'admin' : 'app';
  } catch {
    return 'app';
  }
}

/** The consoles with one address set, as the console it is. */
function withConsole(consoles, origin, name = consoleOfUrl(origin)) {
  return origin ? { ...consoles, [name]: origin } : { ...consoles };
}

const CONSOLE_NAMES = { app: 'the app', admin: 'the admin console' };

function isLocal(hostname) {
  return hostname === 'localhost' || /^[\d.]+$/.test(hostname) || hostname.endsWith('.localhost');
}

// The site a host belongs to, approximated by its last two labels. Enough to
// tell ranch.cleanslice.org's API from a stranger's: no public-suffix list
// here, so a two-label suffix (co.uk) only makes the check stricter.
function siteOf(hostname) {
  return isLocal(hostname) ? hostname : hostname.split('.').slice(-2).join('.');
}

/**
 * Whether a page may name this API (CLEAN-243). Any page can carry a
 * `ranch-api-url` meta; trusting it would send the next site's cookies
 * wherever that page says. Only an API of the page's own site, over https
 * unless it is a local stack.
 */
function trustedApiFor(pageOrigin, apiUrl) {
  try {
    const page = new URL(pageOrigin);
    const api = new URL(apiUrl);
    if (api.protocol !== 'https:' && !isLocal(api.hostname)) return false;
    return siteOf(api.hostname) === siteOf(page.hostname);
  } catch {
    return false;
  }
}

function hostOf(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return origin ?? '';
  }
}

// ── Ranch HTTP ───────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code ?? null;
  }
}

async function fetchJson(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new HttpError(0, `Can't reach ${hostOf(url)}. Check the API address.`);
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Most often the API address points at a console, which answers HTML.
    throw new HttpError(
      res.status,
      `${hostOf(url)} did not answer like the Ranch API. Check the API address.`,
    );
  }
  if (!res.ok) {
    const code = body?.code ?? body?.data?.code ?? null;
    const message = body?.message ?? body?.data?.message ?? `HTTP ${res.status}`;
    throw new HttpError(res.status, Array.isArray(message) ? message.join(', ') : String(message), code);
  }
  // The API wraps responses as `{ success, data }`.
  return body?.data ?? body;
}

/**
 * Borrow the sign-in of one console: renew its session. Null when that
 * console is not signed in on this browser — never the other console's
 * instead, which may be somebody else.
 */
async function signIn(state, name) {
  try {
    const auth = await fetchJson(`${state.apiUrl}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { [CONSOLE_HEADER]: name },
    });
    return auth?.accessToken
      ? { token: auth.accessToken, console: name, user: auth.user ?? null }
      : null;
  } catch (err) {
    // 401 = no live session in this console.
    if (err.status === 401) return null;
    throw err;
  }
}

/**
 * Which consoles hold a session cookie on this browser, without asking the
 * API: the dots on the tabs. A cookie can outlive its session; the refresh
 * is what decides.
 */
async function sessionCookies(apiUrl) {
  const has = async (name) => {
    try {
      const c = await chrome.cookies.get({ url: `${apiUrl}/auth`, name: `ranch_session_${name}` });
      return !!c?.value;
    } catch {
      return false;
    }
  };
  const [app, admin] = await Promise.all([has('app'), has('admin')]);
  return { app, admin };
}

function authed(token, extra = {}) {
  return { ...extra, headers: { Authorization: `Bearer ${token}`, ...(extra.headers ?? {}) } };
}

function postJson(token, body) {
  return authed(token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const api = {
  agents: (s) => fetchJson(`${s.apiUrl}/agents`, authed(session.token)),
  catalogue: (s) => fetchJson(`${s.apiUrl}/integrations/catalogue`, authed(session.token)),
  mintIntegrationToken: (s) =>
    fetchJson(`${s.apiUrl}/integrations/extension/token`, postJson(session.token, { ttlDays: 365 })),
  // Whose browser state the cookies land in is the API's call: the caller's
  // own chat identity (CLEAN-243). Nothing about it is sent from here.
  mintBrowserToken: (s, agentId) =>
    fetchJson(`${s.apiUrl}/browser/extension/token`, postJson(session.token, { agentId, ttlDays: 1 })),
};

/** The `integration:cookies` token, minted again when missing or near expiry. */
async function integrationToken(state, { force = false } = {}) {
  // The token writes into one person's integrations: another console may
  // be another person, so it is theirs only while they are the one here.
  const mine = state.intSub && state.intSub === session?.user?.id;
  const fresh = mine && state.intToken && state.intExp && state.intExp * 1000 > Date.now() + 60_000;
  if (fresh && !force) return state.intToken;
  const minted = await api.mintIntegrationToken(state);
  const patch = { intToken: minted.token, intExp: minted.exp, intSub: session?.user?.id ?? null };
  await saveState(patch);
  Object.assign(state, patch);
  return minted.token;
}

async function catalogueOf(state) {
  const cached = Array.isArray(state.catalogue) && state.catalogueAt > Date.now() - CATALOGUE_TTL_MS;
  if (cached) return state.catalogue;
  const catalogue = await api.catalogue(state);
  await saveState({ catalogue, catalogueAt: Date.now() });
  return catalogue;
}

// ── the page's cookies ───────────────────────────────────────────────

function normalizeSameSite(value) {
  switch ((value ?? '').toLowerCase()) {
    case 'strict':
      return 'Strict';
    case 'no_restriction':
    case 'none':
      return 'None';
    default:
      return 'Lax';
  }
}

function toStorageStateCookie(c) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: typeof c.expirationDate === 'number' ? Math.floor(c.expirationDate) : -1,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: normalizeSameSite(c.sameSite),
  };
}

/**
 * Whether the browser sends cookie `c` to `url`'s host, on some path: a
 * host-only cookie to its own host, a domain cookie to that domain and
 * everything under it, a secure one over https only. The path is left out
 * on purpose — a sign-in cookie often lives on `/api/auth` alone and is
 * still what the site's session stands on.
 */
function sentToHost(c, url) {
  if (c.secure && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  const domain = c.domain.replace(/^\./, '').toLowerCase();
  if (c.hostOnly) return host === domain;
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Every cookie the site's session may stand on: every one the browser sends
 * to this host on any path — parent domains included, where sign-ins like
 * `.google.com` live — and the ones of the site's own subdomains.
 *
 * Asked of Chrome per domain the host is under, then matched here
 * (CLEAN-243): asking by the page's URL leaves out a cookie scoped to
 * another path, and asking by the host's domain leaves out the parent
 * domains, so a `.example.com` cookie on `/api/auth` — the sign-in of a site
 * whose API shares its host — was in neither. Chrome never stores a cookie
 * on a public suffix, so walking up to the last two labels finds nothing
 * foreign; whatever a parent-domain query returns about sibling hosts is
 * dropped by `sentToHost`.
 */
async function readSite(tab) {
  if (!tab?.url) return { host: null, cookies: [] };
  let url;
  try {
    url = new URL(tab.url);
  } catch {
    return { host: null, cookies: [] };
  }
  if (!/^https?:$/.test(url.protocol)) return { host: null, cookies: [] };
  const host = url.hostname.toLowerCase();
  const family = host.replace(/^www\./, '');
  const labels = host.split('.');
  const domains = isLocal(host)
    ? [host]
    : labels.slice(0, -1).map((_, i) => labels.slice(i).join('.'));
  const found = (await Promise.all(domains.map((domain) => chrome.cookies.getAll({ domain })))).flat();
  const seen = new Map();
  for (const c of found) {
    const domain = c.domain.replace(/^\./, '').toLowerCase();
    const ownSubdomain = domain.endsWith(`.${family}`) && (!c.secure || url.protocol === 'https:');
    if (sentToHost(c, url) || ownSubdomain) seen.set(`${c.domain}|${c.path}|${c.name}`, c);
  }
  return { host: url.hostname, cookies: [...seen.values()].map(toStorageStateCookie) };
}

// Catalogue entries claim domains; a page belongs to the one whose domain
// it is or is under.
function detectService(catalogue, hostname) {
  if (!hostname) return null;
  const host = hostname.toLowerCase().replace(/^www\./, '');
  for (const item of catalogue ?? []) {
    if (item.mechanism !== 'browser' || !Array.isArray(item.domains)) continue;
    if (item.domains.some((d) => host === d || host.endsWith(`.${d}`))) return item;
  }
  return null;
}

// A label guessed from the page title, else the domain's first word.
// Labels allow [a-zA-Z0-9_:.-].
function suggestLabel(title, host) {
  const apex = (host ?? '').replace(/^www\./, '').split('.')[0] ?? '';
  const guess = (title ?? '')
    .replace(/^\(\d+\)\s*/, '')
    .split(/[|/·•—–-]/)[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const junk = new Set(['', 'home', 'login', 'log-in', 'signin', 'sign-in', 'dashboard', 'feed', 'inbox']);
  return junk.has(guess) ? apex : guess.slice(0, 60);
}

const LABEL_RE = /^[a-zA-Z0-9_:.-]+$/;

// ── ui helpers ───────────────────────────────────────────────────────

function showScreen(name) {
  for (const s of ['loading', 'setup', 'login', 'main']) $(`screen-${s}`).hidden = s !== name;
  closeMenu();
}

/** Build an element tree without HTML strings: every value is text. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function setMessage(el, kind, ...content) {
  if (!content.length) {
    el.hidden = true;
    el.replaceChildren();
    return;
  }
  el.className = `${el.id === 'notice' ? 'notice' : 'status'} ${kind}`.trim();
  el.replaceChildren(...content.flat().map((c) => (c instanceof Node ? c : document.createTextNode(String(c)))));
  el.hidden = false;
}

function setStatus(kind, ...content) {
  setMessage($('status'), kind, ...content);
}

function showError(el, message) {
  el.textContent = message ?? '';
  el.hidden = !message;
}

function setHeader(state) {
  const who = $('top-who');
  const menuBtn = $('menu-btn');
  if (!state?.apiUrl) {
    who.hidden = true;
    menuBtn.hidden = true;
    $('console-tabs').hidden = true;
    return;
  }
  // Who the cookies will be sent as.
  who.textContent = session?.user?.email ?? hostOf(state.consoles?.app ?? state.apiUrl);
  who.title = session?.user ? `Signed in to ${CONSOLE_NAMES[session.console]} as ${session.user.email} (${session.user.role})` : '';
  who.hidden = false;
  menuBtn.hidden = false;
  $('menu-host').textContent = [
    state.consoles?.app && `App ${state.consoles.app}`,
    state.consoles?.admin && `Admin ${state.consoles.admin}`,
    `API ${state.apiUrl}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** The tabs: the chosen console, and a dot for each one holding a session. */
function setTabs(chosen, signedIn) {
  $('console-tabs').hidden = false;
  for (const tab of document.querySelectorAll('#console-tabs [role="tab"]')) {
    const name = tab.dataset.console;
    tab.setAttribute('aria-selected', String(name === chosen));
    tab.tabIndex = name === chosen ? 0 : -1;
    tab.querySelector('.dot').classList.toggle('on', !!signedIn[name]);
    tab.title = signedIn[name] ? `Signed in to ${CONSOLE_NAMES[name]}` : `Not signed in to ${CONSOLE_NAMES[name]}`;
  }
}

async function chooseConsole(name) {
  const state = await loadState();
  if (state.console === name && session?.console === name) return;
  await saveState({ console: name });
  // Another console may be another person: nothing of the last one's stays.
  agentsCache = null;
  session = null;
  await startup();
}

function closeMenu() {
  $('menu').hidden = true;
  $('menu-btn').setAttribute('aria-expanded', 'false');
}

// ── startup ──────────────────────────────────────────────────────────

async function startup() {
  showScreen('loading');
  const state = await loadState();
  if (!state.apiUrl) return goSetup();
  // A local stack's consoles have no address to derive: learn the one in
  // the open tab, when it is this Ranch's. Local only: a deployed Ranch's
  // addresses are derived, and a page must never get to say where the
  // sign-in button leads.
  if (isLocal(new URL(state.apiUrl).hostname) && (!state.consoles?.app || !state.consoles?.admin)) {
    const found = await detectRanchTab();
    if (found?.apiUrl === state.apiUrl && isLocal(new URL(found.consoleUrl).hostname)) {
      const name = found.console ?? consoleOfUrl(found.consoleUrl);
      if (state.consoles?.[name] !== found.consoleUrl) {
        state.consoles = withConsole(state.consoles ?? {}, found.consoleUrl, name);
        await saveState({ consoles: state.consoles });
      }
    }
  }

  // The person's pick; before they made one, the console signed in here,
  // the app first.
  const signedIn = await sessionCookies(state.apiUrl);
  const chosen = CONSOLES.includes(state.console)
    ? state.console
    : signedIn.app || !signedIn.admin
      ? 'app'
      : 'admin';
  if (state.console !== chosen) await saveState({ console: chosen });
  state.console = chosen;
  setTabs(chosen, signedIn);
  setHeader(state);

  try {
    session = await signIn(state, chosen);
  } catch (err) {
    // The API itself is unreachable or answers garbage: the address is
    // what to fix.
    return goSetup(err.message);
  }
  setTabs(chosen, { ...signedIn, [chosen]: !!session });
  if (!session) return goLogin(state, chosen, signedIn);
  setHeader(state);
  return renderMain(state);
}

// ── setup ────────────────────────────────────────────────────────────

/**
 * A Ranch console advertises its API in `<meta name="ranch-api-url">` and
 * names itself in `<meta name="ranch-console">`. Null for any other page.
 */
async function detectRanchTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url ?? '')) return null;
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        apiUrl: document.querySelector('meta[name="ranch-api-url"]')?.content || null,
        console: document.querySelector('meta[name="ranch-console"]')?.content || null,
      }),
    });
    const found = injected?.result;
    const consoleUrl = new URL(tab.url).origin;
    const apiUrl = normalize(found?.apiUrl);
    if (!apiUrl || !trustedApiFor(consoleUrl, apiUrl)) return null;
    return {
      consoleUrl,
      apiUrl,
      console: CONSOLES.includes(found.console) ? found.console : null,
    };
  } catch {
    return null;
  }
}

async function goSetup(error) {
  session = null;
  const state = await loadState();
  setHeader(null);
  const known = state.consoles?.[state.console] ?? state.consoles?.app ?? state.consoles?.admin ?? '';
  $('setup-url').value = known;
  $('setup-api').value = state.apiUrl ?? '';
  apiUrlEdited = !!state.apiUrl && state.apiUrl !== deriveApiUrl(known);
  $('setup-advanced').open = apiUrlEdited;
  showError($('setup-error'), error);
  $('detect-card').hidden = true;
  showScreen('setup');

  const found = await detectRanchTab();
  if (!found) {
    if (!$('setup-url').value) $('setup-url').placeholder = PROD_CONSOLE;
    return;
  }
  $('detect-host').textContent = hostOf(found.consoleUrl);
  // Say where it connects, not what the page calls itself.
  $('detect-note').textContent = `API ${hostOf(found.apiUrl)}`;
  $('detect-use').onclick = async () => {
    const name = found.console ?? consoleOfUrl(found.consoleUrl);
    const known = state.apiUrl === found.apiUrl ? state.consoles : {};
    await saveState({
      apiUrl: found.apiUrl,
      consoles: withConsole({ ...consolesOf(found.apiUrl), ...known }, found.consoleUrl, name),
      console: name,
      catalogue: null,
      intToken: null,
      intExp: null,
      intSub: null,
    });
    agentsCache = null;
    await startup();
  };
  $('detect-card').hidden = false;
}

$('setup-url').addEventListener('input', () => {
  if (apiUrlEdited) return;
  const origin = normalize($('setup-url').value);
  $('setup-api').value = origin ? deriveApiUrl(origin) : '';
});
$('setup-api').addEventListener('input', () => {
  apiUrlEdited = true;
});

$('setup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const consoleUrl = normalize($('setup-url').value);
  if (!consoleUrl) {
    showError($('setup-error'), `Enter the address of your Ranch console, e.g. ${PROD_CONSOLE}`);
    $('setup-url').focus();
    return;
  }
  const apiUrl = normalize($('setup-api').value) ?? deriveApiUrl(consoleUrl);
  if (apiUrl === consoleUrl && !apiUrlEdited) {
    $('setup-advanced').open = true;
    showError($('setup-error'), 'Enter the API address too — on this host it has its own port.');
    $('setup-api').focus();
    return;
  }
  const state = await loadState();
  const sameRanch = state.apiUrl === apiUrl;
  const name = consoleOfUrl(consoleUrl);
  // Another Ranch: nothing minted for the old one is any good here.
  await saveState({
    apiUrl,
    consoles: withConsole(sameRanch ? { ...consolesOf(apiUrl), ...state.consoles } : consolesOf(apiUrl), consoleUrl, name),
    console: name,
    ...(sameRanch ? {} : { catalogue: null, intToken: null, intExp: null, intSub: null }),
  });
  agentsCache = null;
  await startup();
});

// ── login ────────────────────────────────────────────────────────────

function goLogin(state, name, signedIn = {}, error) {
  session = null;
  const url = state.consoles?.[name];
  const other = CONSOLES.find((c) => c !== name);
  $('login-title').textContent = name === 'admin' ? 'Sign in to the admin console' : 'Sign in to the app';
  $('login-text').replaceChildren(
    `The extension sends cookies as the person signed in to ${CONSOLE_NAMES[name]}`,
    ...(url ? [' on ', h('span', { class: 'mono' }, hostOf(url))] : []),
    '. ',
    url ? 'Sign in there, then come back.' : `Open ${CONSOLE_NAMES[name]} in a tab and click the icon there.`,
    signedIn[other] ? ` You're signed in to ${CONSOLE_NAMES[other]} — switch above to send as that account.` : '',
  );
  $('login-open').disabled = !url;
  $('login-open').onclick = () => url && chrome.tabs.create({ url: `${url}/login` });
  showError($('login-error'), error);
  setHeader(state);
  showScreen('login');
}
$('login-retry').addEventListener('click', () => startup());

// ── main ─────────────────────────────────────────────────────────────

async function renderMain(state) {
  showScreen('main');
  setStatus('');
  setMessage($('notice'), '');
  $('ranch-self').hidden = true;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { host, cookies } = await readSite(tab);

  // Site card
  $('site-host').textContent = host ?? 'No website in this tab';
  $('site-count').textContent = !host
    ? 'Open the site you want your agents to use.'
    : cookies.length === 0
      ? 'No cookies — sign in to the site first'
      : `${cookies.length} cookie${cookies.length === 1 ? '' : 's'} on this site`;
  // Which ones, by name — never the values — for "why isn't it signed in".
  $('site-count').title = cookies.map((c) => `${c.name} (${c.domain}${c.path})`).join('\n');
  const icon = $('site-icon');
  icon.hidden = !(host && tab?.favIconUrl && /^https?:|^data:/.test(tab.favIconUrl));
  if (!icon.hidden) icon.src = tab.favIconUrl;
  $('site-icon-fallback').hidden = !icon.hidden;

  // Ranch's own cookies are nothing an agent can use: its sign-in lives on
  // the API host and is the person's, not a site's.
  const ranchHosts = [state.apiUrl, state.consoles?.app, state.consoles?.admin]
    .filter(Boolean)
    .map((u) => new URL(u).hostname);
  const isRanch = !!host && ranchHosts.includes(host);
  $('ranch-self').hidden = !isRanch;
  if (!host || isRanch) {
    $('send-form').hidden = true;
    $('site-service').hidden = true;
    return;
  }
  $('send-form').hidden = false;

  let catalogue = [];
  let catalogueError = null;
  try {
    catalogue = await catalogueOf(state);
  } catch (err) {
    catalogueError = err;
  }
  const service = detectService(catalogue, host);

  $('site-service').hidden = !service;
  $('site-service').textContent = service?.title ?? '';

  // Integrations are an administrator's (the API refuses anyone else's
  // token); below that, a person sends to the agents they pick, and nothing
  // about integrations is theirs to be told.
  const canIntegrate = ['Owner', 'Admin'].includes(session?.user?.role);
  if (canIntegrate && catalogueError) {
    setMessage(
      $('notice'),
      'warn',
      h('strong', {}, "Couldn't load the integration catalogue. "),
      catalogueError.message,
      ' You can still send to specific agents.',
    );
  } else if (canIntegrate && !service) {
    setMessage(
      $('notice'),
      'warn',
      h('strong', {}, host),
      " isn't one of the integrations, so it can't go to all your agents at once. Send it to specific agents instead.",
    );
  }

  // Account label
  const accountKey = $('account-key');
  const remembered = service ? state.lastAccountKeys?.[service.service] : state.lastAccountKeys?.[host];
  accountKey.value = remembered ?? suggestLabel(tab?.title, host);
  accountKey.placeholder = service?.accountKeyHint ?? 'business';
  $('account-hint').textContent = service
    ? 'Names this account, so one site can hold several. Agents open it by this name.'
    : 'Agents open this site, signed in as you, by this name.';

  const ctx = { state, host, service, cookies, canIntegrate };
  accountKey.oninput = () => refreshSend(ctx);
  wireScope(ctx);
  document.querySelector('.segmented [data-scope="all"]').disabled = !canIntegrate;
  setScope(ctx, service && canIntegrate ? 'all' : 'some');
  $('send-btn').onclick = () => send(ctx);
}

function currentScope() {
  return document.querySelector('.segmented [aria-checked="true"]')?.dataset.scope ?? 'all';
}

function wireScope(ctx) {
  const buttons = [...document.querySelectorAll('.segmented [role="radio"]')];
  buttons.forEach((btn, i) => {
    btn.onclick = () => setScope(ctx, btn.dataset.scope);
    btn.onkeydown = (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = buttons[(i + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
      setScope(ctx, next.dataset.scope);
      next.focus();
    };
  });
}

async function setScope(ctx, scope) {
  for (const btn of document.querySelectorAll('.segmented [role="radio"]')) {
    const on = btn.dataset.scope === scope;
    btn.setAttribute('aria-checked', String(on));
    btn.tabIndex = on ? 0 : -1;
  }
  setStatus('');
  if (scope === 'all') {
    $('agents').hidden = true;
    $('scope-hint').textContent = 'Saved to your integrations — every agent you use can sign in with it.';
  } else {
    $('agents').hidden = false;
    $('scope-hint').textContent = 'Only the agents you tick get these cookies.';
    await renderAgents(ctx);
  }
  refreshSend(ctx);
}

async function renderAgents(ctx) {
  const box = $('agents');
  if (!agentsCache) {
    box.replaceChildren(h('div', { class: 'agents-msg' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Loading agents…'));
    try {
      const list = await api.agents(ctx.state);
      if (!Array.isArray(list)) throw new Error('Unexpected answer from the API.');
      agentsCache = [...list].sort(
        (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || String(a.name).localeCompare(String(b.name)),
      );
    } catch (err) {
      box.replaceChildren(h('div', { class: 'agents-msg' }, `Couldn't load agents — ${err.message}`));
      return;
    }
  }
  if (agentsCache.length === 0) {
    box.replaceChildren(h('div', { class: 'agents-msg' }, 'No agents on this account yet.'));
    return;
  }
  box.replaceChildren(
    ...agentsCache.map((a) => {
      const input = h('input', { type: 'checkbox', value: a.id });
      input.onchange = () => refreshSend(ctx);
      return h('label', { class: 'agent' }, input, h('span', { class: 'name' }, a.name ?? a.id), a.pinned ? h('span', { class: 'badge' }, 'pinned') : null);
    }),
  );
}

function selectedAgentIds() {
  return [...document.querySelectorAll('.agent input:checked')].map((el) => el.value);
}

/** Enables Send, and says why when it can't be pressed. */
function refreshSend(ctx) {
  const scope = currentScope();
  const label = $('account-key').value.trim();
  const picked = selectedAgentIds().length;
  let why = null;
  if (ctx.cookies.length === 0) why = 'Sign in to this site first — there are no cookies to send.';
  else if (!label) why = 'Give the account a label.';
  else if (!LABEL_RE.test(label)) why = 'Labels use letters, digits and _ : . - only.';
  else if (scope === 'all' && !ctx.canIntegrate) why = 'Integrations are set up by an administrator.';
  else if (scope === 'all' && !ctx.service) why = 'This site needs "Specific agents".';
  else if (scope === 'some' && picked === 0) why = 'Tick at least one agent.';

  const btn = $('send-btn');
  btn.disabled = !!why;
  btn.textContent =
    scope === 'all' ? 'Send to all my agents' : picked > 0 ? `Send to ${picked} agent${picked === 1 ? '' : 's'}` : 'Send cookies';
  $('send-why').textContent = why ?? '';
  $('send-why').hidden = !why;
}

async function send(ctx) {
  const scope = currentScope();
  const label = $('account-key').value.trim();
  $('send-btn').disabled = true;
  setStatus('busy', h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Sending…');
  try {
    // The borrowed token is short-lived; a popup left open outlives it.
    session = await signIn(ctx.state, ctx.state.console);
    if (!session) {
      return goLogin(ctx.state, ctx.state.console, {}, 'Your Ranch sign-in ended. Sign in again, then send.');
    }
    if (scope === 'all') await sendToIntegrations(ctx, label);
    else await sendToAgents(ctx, label);
  } catch (err) {
    setStatus('err', `Couldn't send — ${describeSendError(err)}`);
  } finally {
    refreshSend(ctx);
  }
}

/** What went wrong, in the person's terms where the API's are a code. */
function describeSendError(err) {
  if (err.status === 403) return "your Ranch role isn't allowed to hand cookies to agents";
  if (err.status === 404) return 'that agent is no longer yours to reach';
  return err.message;
}

async function rememberLabel(ctx, label) {
  const key = ctx.service?.service ?? ctx.host;
  const state = await loadState();
  await saveState({ lastAccountKeys: { ...(state.lastAccountKeys ?? {}), [key]: label } });
}

// "All my agents": the person's own integration store, which every agent
// they use reads.
async function sendToIntegrations(ctx, label) {
  const { state, service, cookies } = ctx;
  const body = { service: service.service, accountKey: label, cookies, origins: [], userAgent: navigator.userAgent };
  const push = async (token) =>
    fetchJson(`${state.apiUrl}/integrations/extension/import-state`, postJson(token, body));
  let res;
  try {
    res = await push(await integrationToken(state));
  } catch (err) {
    // A stored token from before a revocation, or from another Ranch.
    if (err.status !== 401) throw err;
    res = await push(await integrationToken(state, { force: true }));
  }
  await rememberLabel(ctx, label);
  setStatus(
    'ok',
    h('strong', {}, `Saved to your ${service.title} integration as "${label}". `),
    `Every agent you use can now open ${service.title} as you — ask any of them, e.g. "open ${service.title} as ${label} and …". `,
    `(${res?.cookies ?? cookies.length} cookies.)`,
  );
}

// "Specific agents": each agent's own browser store, filed under the
// person's chat identity by the API.
/**
 * The agent's chat in the console the cookies were sent from, naming the
 * session just shared (CLEAN-243). The console writes the message from
 * these two — the site, the profile, and a «…» for the task — and puts it in
 * the box; the person finishes it and presses Enter. A link carries no free
 * text, so nobody's link can put instructions in front of an agent.
 */
function chatUrl(state, agentId, profile, site) {
  const consoleUrl = state.consoles?.[session?.console ?? state.console];
  if (!consoleUrl) return null;
  const url = new URL(`/agents/${encodeURIComponent(agentId)}`, consoleUrl);
  url.searchParams.set('shared', profile);
  url.searchParams.set('site', site);
  return url.href;
}

function openChat(url) {
  if (url) chrome.tabs.create({ url });
}

// "Specific agents": each agent's own browser store, filed under the
// person's chat identity by the API. Then on to the chat: the agent knows
// nothing until it is told, so the popup opens the chat with the message
// in the box — straight away for one agent, a button per agent for more.
async function sendToAgents(ctx, label) {
  const { state, host, service, cookies } = ctx;
  const profile = service ? `${service.service}:${label}` : label;
  const ok = [];
  const failed = [];
  for (const agentId of selectedAgentIds()) {
    const name = agentsCache?.find((a) => a.id === agentId)?.name ?? agentId;
    try {
      const minted = await api.mintBrowserToken(state, agentId);
      await fetchJson(
        `${state.apiUrl}/browser/extension/import-state`,
        postJson(minted.token, { profile, cookies, origins: [], userAgent: navigator.userAgent }),
      );
      ok.push({ agentId, name });
    } catch (err) {
      failed.push(`${name} (${describeSendError(err)})`);
    }
  }
  if (ok.length) await rememberLabel(ctx, label);
  if (!ok.length) {
    setStatus('err', `Couldn't send — ${failed.join('; ')}`);
    return;
  }

  const site = service?.title ?? host;
  const chatButtons = ok.map(({ agentId, name }) => {
    const btn = h('button', { type: 'button', class: 'btn sm' }, ok.length === 1 ? 'Open the chat again' : `Open chat with ${name}`);
    btn.onclick = () => openChat(chatUrl(state, agentId, profile, host));
    return btn;
  });
  setStatus(
    failed.length ? 'err' : 'ok',
    h(
      'p',
      {},
      h('strong', {}, ok.length === 1 ? `${ok[0].name} can now open ${site} as you. ` : `Sent to ${ok.map((a) => a.name).join(', ')}. `),
      ok.length === 1
        ? 'Its chat is open with a message ready — say what to do there and send it.'
        : 'Open a chat — the message is ready, say what to do and send it.',
    ),
    failed.length ? h('p', {}, `Failed: ${failed.join('; ')}`) : null,
    h('div', { class: 'status-actions' }, chatButtons),
  );
  // One agent: go there now. Several: the person picks.
  if (ok.length === 1) openChat(chatUrl(state, ok[0].agentId, profile, host));
}

// ── console tabs ─────────────────────────────────────────────────────

{
  const tabs = [...document.querySelectorAll('#console-tabs [role="tab"]')];
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => chooseConsole(tab.dataset.console));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = tabs[(i + 1) % tabs.length];
      next.focus();
      chooseConsole(next.dataset.console);
    });
  });
}

// ── menu ─────────────────────────────────────────────────────────────

$('menu-btn').addEventListener('click', (event) => {
  event.stopPropagation();
  const open = $('menu').hidden;
  $('menu').hidden = !open;
  $('menu-btn').setAttribute('aria-expanded', String(open));
  if (open) $('menu-change').focus();
});
document.addEventListener('click', (event) => {
  if (!$('menu').hidden && !$('menu').contains(event.target)) closeMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('menu').hidden) {
    closeMenu();
    $('menu-btn').focus();
  }
});
$('menu-change').addEventListener('click', () => goSetup());
$('menu-disconnect').addEventListener('click', async () => {
  await clearState();
  agentsCache = null;
  session = null;
  await goSetup();
});

startup();
