// Ranch Cookies popup. Screens: loading → setup → login → main.
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
// The access token lives in this popup's memory and nowhere else. What is
// stored is the Ranch address, the long-lived `integration:cookies` token
// for the "all my agents" push, the catalogue and the last labels.

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
  if (data[STORE_KEY]) return data[STORE_KEY];
  // 0.4 stored the admin URL and a token minted from the admin cookie.
  // Keep the addresses, drop the rest: the token is re-minted on sign-in.
  const legacy = data[LEGACY_STORE_KEY];
  if (!legacy?.adminUrl) return {};
  const migrated = {
    consoleUrl: legacy.adminUrl,
    apiUrl: legacy.apiUrl ?? deriveApiUrl(legacy.adminUrl),
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
 * Borrow a console sign-in: renew the session of the console that has one.
 * Tries the console that worked last time first. Null when neither console
 * is signed in on this browser.
 */
async function signIn(state) {
  const order = state.console
    ? [state.console, ...CONSOLES.filter((c) => c !== state.console)]
    : CONSOLES;
  let lastError = null;
  for (const name of order) {
    try {
      const auth = await fetchJson(`${state.apiUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { [CONSOLE_HEADER]: name },
      });
      if (!auth?.accessToken) continue;
      return { token: auth.accessToken, console: name, user: auth.user ?? null };
    } catch (err) {
      // 401 = no live session in this console; try the other one.
      if (err.status !== 401) lastError = err;
    }
  }
  if (lastError) throw lastError;
  return null;
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
  const fresh = state.intToken && state.intExp && state.intExp * 1000 > Date.now() + 60_000;
  if (fresh && !force) return state.intToken;
  const minted = await api.mintIntegrationToken(state);
  await saveState({ intToken: minted.token, intExp: minted.exp });
  state.intToken = minted.token;
  state.intExp = minted.exp;
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
 * Every cookie the site's session may stand on: the ones sent to this very
 * page — parent domains included, where sign-ins like `.google.com` live —
 * and the ones of the site's other subdomains.
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
  const [sent, family] = await Promise.all([
    chrome.cookies.getAll({ url: url.href }),
    chrome.cookies.getAll({ domain: url.hostname.replace(/^www\./, '') }),
  ]);
  const seen = new Map();
  for (const c of [...sent, ...family]) seen.set(`${c.domain}|${c.path}|${c.name}`, c);
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
  if (!state?.consoleUrl) {
    who.hidden = true;
    menuBtn.hidden = true;
    return;
  }
  who.textContent = session ? `${hostOf(state.consoleUrl)} · ${session.console}` : hostOf(state.consoleUrl);
  who.title = session?.user?.email ? `Signed in as ${session.user.email}` : '';
  who.hidden = false;
  menuBtn.hidden = false;
  $('menu-host').textContent = `${state.consoleUrl}\nAPI ${state.apiUrl}`;
}

function closeMenu() {
  $('menu').hidden = true;
  $('menu-btn').setAttribute('aria-expanded', 'false');
}

// ── startup ──────────────────────────────────────────────────────────

async function startup() {
  showScreen('loading');
  const state = await loadState();
  if (!state.consoleUrl || !state.apiUrl) return goSetup();
  setHeader(state);

  try {
    session = await signIn(state);
  } catch (err) {
    // The API itself is unreachable or answers garbage: the address is
    // what to fix.
    return goSetup(err.message);
  }
  if (!session) return goLogin(state);
  if (session.console !== state.console) await saveState({ console: session.console });
  state.console = session.console;
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
    if (!found?.apiUrl) return null;
    return {
      consoleUrl: new URL(tab.url).origin,
      apiUrl: normalize(found.apiUrl) ?? found.apiUrl,
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
  $('setup-url').value = state.consoleUrl ?? '';
  $('setup-api').value = state.apiUrl ?? '';
  apiUrlEdited = !!state.apiUrl && state.apiUrl !== deriveApiUrl(state.consoleUrl ?? '');
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
  $('detect-note').textContent =
    found.console === 'admin' ? 'Ranch admin console in this tab' : 'Ranch console in this tab';
  $('detect-use').onclick = async () => {
    await saveState({
      consoleUrl: found.consoleUrl,
      apiUrl: found.apiUrl,
      console: found.console ?? undefined,
      catalogue: null,
      intToken: null,
      intExp: null,
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
  // Another Ranch: nothing minted for the old one is any good here.
  await saveState({
    consoleUrl,
    apiUrl,
    ...(sameRanch ? {} : { console: null, catalogue: null, intToken: null, intExp: null }),
  });
  agentsCache = null;
  await startup();
});

// ── login ────────────────────────────────────────────────────────────

function goLogin(state, error) {
  session = null;
  $('login-host').textContent = hostOf(state.consoleUrl);
  showError($('login-error'), error);
  setHeader(state);
  showScreen('login');
}

$('login-open').addEventListener('click', async () => {
  const { consoleUrl } = await loadState();
  if (consoleUrl) chrome.tabs.create({ url: `${consoleUrl}/login` });
});
$('login-retry').addEventListener('click', () => startup());

// ── main ─────────────────────────────────────────────────────────────

async function renderMain(state) {
  showScreen('main');
  setStatus('');
  setMessage($('notice'), '');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { host, cookies } = await readSite(tab);

  // Site card
  $('site-host').textContent = host ?? 'No website in this tab';
  $('site-count').textContent = !host
    ? 'Open the site you want your agents to use.'
    : cookies.length === 0
      ? 'No cookies — sign in to the site first'
      : `${cookies.length} cookie${cookies.length === 1 ? '' : 's'} on this site`;
  const icon = $('site-icon');
  icon.hidden = !(host && tab?.favIconUrl && /^https?:|^data:/.test(tab.favIconUrl));
  if (!icon.hidden) icon.src = tab.favIconUrl;
  $('site-icon-fallback').hidden = !icon.hidden;

  if (!host) {
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

  if (catalogueError?.status === 403) {
    setMessage(
      $('notice'),
      'warn',
      h('strong', {}, 'Integrations need an administrator account. '),
      'Your Ranch role can send cookies only where an administrator allows it.',
    );
  } else if (catalogueError) {
    setMessage(
      $('notice'),
      'warn',
      h('strong', {}, "Couldn't load the integration catalogue. "),
      catalogueError.message,
      ' You can still send to specific agents.',
    );
  } else if (!service) {
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
    ? 'A name for this account, so one site can hold several.'
    : 'The profile your agents open with browser_play.';

  const ctx = { state, host, service, cookies };
  accountKey.oninput = () => refreshSend(ctx);
  wireScope(ctx);
  setScope(ctx, service ? 'all' : 'some');
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
    session = (await signIn(ctx.state)) ?? null;
    if (!session) return goLogin(ctx.state, 'Your Ranch sign-in ended. Sign in again, then send.');
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
    `Sent ${res?.cookies ?? cookies.length} cookies to ${service.title}. Your agents sign in with `,
    h('code', {}, `browser_play(profile: "${service.service}:${label}")`),
    '.',
  );
}

// "Specific agents": each agent's own browser store, filed under the
// person's chat identity by the API.
async function sendToAgents(ctx, label) {
  const { state, service, cookies } = ctx;
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
      ok.push(name);
    } catch (err) {
      failed.push(`${name} (${describeSendError(err)})`);
    }
  }
  if (ok.length) await rememberLabel(ctx, label);
  if (!failed.length) {
    setStatus('ok', `Sent to ${ok.join(', ')}. They sign in with `, h('code', {}, `browser_play(profile: "${profile}")`), '.');
  } else if (!ok.length) {
    setStatus('err', `Couldn't send — ${failed.join('; ')}`);
  } else {
    setStatus('err', `Sent to ${ok.join(', ')}. Failed: ${failed.join('; ')}`);
  }
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
