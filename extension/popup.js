// Popup controller. State machine: setup → login → ready.
//
// The flow auto-derives almost everything from the Ranch admin URL the
// user pastes once:
//   - Admin URL (e.g. https://admin.ranch.cleanslice.org) — we read the
//     `access_token` cookie from this origin using chrome.cookies.get.
//   - API URL — derived by swapping the leading "admin." host segment
//     for "api." (the cleanslice convention).
//   - Integration token — minted server-side at
//     /integrations/extension/token with the admin JWT, scoped to the
//     caller. Used for the default "all my agents" push.
//
// There is NO separate "pick an agent" step. By default cookies go to
// the per-user integration store (visible to every agent the user
// runs). The user can optionally narrow the push to specific agents on
// the main screen — those go to each agent's per-agent browser store
// via a freshly-minted browser:cookies token.

const STORE_KEY = 'ranch-cookies:v2';
const $ = (id) => document.getElementById(id);

// userId baked into per-agent pushes. The agent-scoped browser store is
// keyed by (agentId, userId, profile); "admin" is the default runtime
// identity for admin chat. Surfacing this as an input only confused
// users, so it is fixed here.
const AGENT_USER_ID = 'admin';

// Agents fetched lazily the first time the user opens "Specific agents".
// Cached for the lifetime of this popup only.
let agentsCache = null;

// Once the user edits the API URL by hand we stop mirroring it to the
// admin URL. Also set true when prefilling a known API URL on re-edit.
let apiUrlEdited = false;

// ── persistence ──────────────────────────────────────────────────────

async function loadState() {
  const data = await chrome.storage.local.get(STORE_KEY);
  return data[STORE_KEY] ?? {};
}
async function saveState(patch) {
  const cur = await loadState();
  const merged = { ...cur, ...patch };
  await chrome.storage.local.set({ [STORE_KEY]: merged });
  return merged;
}
async function clearState() {
  await chrome.storage.local.remove(STORE_KEY);
}

// ── url helpers ──────────────────────────────────────────────────────

function normalize(raw) {
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  return u.origin;
}

// Convention used by ranch deploys: admin.{domain} ↔ api.{domain}. If the
// admin host doesn't start with `admin.`, fall back to the same origin.
function deriveApiUrl(adminOrigin) {
  try {
    const u = new URL(adminOrigin);
    if (u.hostname.startsWith('admin.')) {
      u.hostname = 'api.' + u.hostname.slice('admin.'.length);
      return u.origin;
    }
    return adminOrigin;
  } catch {
    return adminOrigin;
  }
}

// ── ranch HTTP ──────────────────────────────────────────────────────

async function getAdminJwt(adminUrl) {
  try {
    const cookie = await chrome.cookies.get({ url: adminUrl, name: 'access_token' });
    return cookie?.value || null;
  } catch (err) {
    console.warn('chrome.cookies.get failed:', err);
    return null;
  }
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`);
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    // The API URL probably resolved to a non-API host (e.g. the Nuxt
    // admin app), which serves an HTML page. Give a readable hint
    // instead of the raw "Unexpected token '<'" parser error.
    throw new Error(
      `Expected JSON from ${url} but got HTML — check the API URL.`,
    );
  }
  // ranch-api wraps responses in `{success, data}`; pass either shape through.
  return body?.data ?? body;
}

async function listAgents(apiUrl, jwt) {
  return fetchJson(`${apiUrl}/agents`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
}

async function mintIntegrationToken(apiUrl, jwt) {
  return fetchJson(`${apiUrl}/integrations/extension/token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ttlDays: 365 }),
  });
}

async function mintBrowserToken(apiUrl, jwt, agentId) {
  return fetchJson(`${apiUrl}/browser/extension/token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ agentId, userId: AGENT_USER_ID, ttlDays: 365 }),
  });
}

async function fetchCatalogue(apiUrl, jwt) {
  return fetchJson(`${apiUrl}/integrations/catalogue`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
}

// Best-effort account-label suggestion from the page title, falling
// back to the apex domain word. Account labels allow [a-zA-Z0-9_:.\-].
function suggestLabel(title, host) {
  const apex = (host || '').replace(/^www\./, '').split('.')[0] || '';
  const t = (title || '')
    .replace(/^\(\d+\)\s*/, '')        // strip "(19) " unread count
    .split(/[|/·•—–\-]/)[0]            // first segment before a separator
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:.\-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const junk = new Set([
    '', 'home', 'login', 'log-in', 'signin', 'sign-in', 'dashboard', 'feed',
  ]);
  return junk.has(t) ? apex : t.slice(0, 60);
}

// Suffix-match the current hostname against catalogue.domains. Returns
// the catalogue item whose domain list claims the page, or null.
function detectService(catalogue, hostname) {
  if (!hostname) return null;
  const lower = hostname.toLowerCase().replace(/^www\./, '');
  for (const item of catalogue) {
    if (item.mechanism !== 'browser' || !Array.isArray(item.domains)) continue;
    for (const domain of item.domains) {
      if (lower === domain || lower.endsWith('.' + domain)) return item;
    }
  }
  return null;
}

// ── cookies ──────────────────────────────────────────────────────────

function normalizeSameSite(s) {
  switch ((s || '').toLowerCase()) {
    case 'strict': return 'Strict';
    case 'lax':    return 'Lax';
    case 'no_restriction':
    case 'none':   return 'None';
    default:       return 'Lax';
  }
}

function toStorageStateCookies(raw) {
  return raw.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: typeof c.expirationDate === 'number' ? Math.floor(c.expirationDate) : -1,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: normalizeSameSite(c.sameSite),
  }));
}

async function readCookiesForTab(tab) {
  if (!tab?.url) return { host: '(no tab)', cookies: [] };
  try {
    const url = new URL(tab.url);
    if (!/^https?:$/.test(url.protocol)) {
      return { host: '(non-http page)', cookies: [] };
    }
    const apex = url.hostname.replace(/^www\./, '');
    const cookies = await chrome.cookies.getAll({ domain: apex });
    return { host: url.hostname, cookies };
  } catch (err) {
    return { host: '(error)', cookies: [], error: err.message };
  }
}

// ── ui helpers ───────────────────────────────────────────────────────

function showScreen(name) {
  for (const s of ['setup', 'login', 'main']) {
    $(`screen-${s}`).hidden = s !== name;
  }
}

function setStatus(msg, kind) {
  const el = $('status');
  if (!msg) {
    el.hidden = true;
    return;
  }
  el.innerHTML = msg;
  el.className = 'status ' + kind;
  el.hidden = false;
}

// ── startup ──────────────────────────────────────────────────────────

async function startup() {
  const state = await loadState();
  if (!state.adminUrl) return goSetup();

  const jwt = await getAdminJwt(state.adminUrl);
  if (!jwt) {
    $('login-host').textContent = new URL(state.adminUrl).hostname;
    return showScreen('login');
  }

  // Mint the integration token in the background — this is the default
  // ("all my agents") push path and has no per-agent state.
  const apiUrl = state.apiUrl ?? deriveApiUrl(state.adminUrl);
  let nextState = state;
  if (
    !state.intToken ||
    (state.intExp && state.intExp * 1000 < Date.now() + 60_000)
  ) {
    try {
      const minted = await mintIntegrationToken(apiUrl, jwt);
      nextState = await saveState({
        apiUrl,
        intToken: minted.token,
        intExp: minted.exp,
      });
    } catch (err) {
      // Non-fatal — "specific agents" still works without it.
      console.warn('Could not mint integration token:', err.message);
      nextState = await saveState({ apiUrl });
    }
  }

  return renderMain(nextState);
}

// ── main screen ──────────────────────────────────────────────────────

async function renderMain(state) {
  showScreen('main');
  $('head-host').textContent = new URL(state.adminUrl).hostname;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { host, cookies } = await readCookiesForTab(tab);
  const storageStateCookies = toStorageStateCookies(cookies);

  // site card
  $('site-host').textContent = host;
  $('site-dot').classList.toggle('on', storageStateCookies.length > 0);
  $('site-count').textContent =
    storageStateCookies.length === 0
      ? 'no cookies'
      : `${storageStateCookies.length} cookies`;

  // resolve the catalogue (cached in chrome.storage; refreshed on reconnect)
  let catalogue = state.catalogue;
  let catalogueError = null;
  if (!catalogue || !catalogue.length) {
    try {
      const jwt = await getAdminJwt(state.adminUrl);
      if (jwt) {
        catalogue = await fetchCatalogue(state.apiUrl, jwt);
        await saveState({ catalogue });
      }
    } catch (err) {
      catalogueError = err.message;
      console.warn('Could not fetch catalogue:', err.message);
    }
  }
  const service = detectService(catalogue ?? [], host);

  // detection banner
  const detectedEl = $('detected');
  detectedEl.hidden = false;
  if (service) {
    detectedEl.className = 'banner ok';
    detectedEl.innerHTML = `<strong>${service.title}</strong> detected — cookies will be saved to your <em>${service.service}</em> integration.`;
  } else if (catalogueError) {
    detectedEl.className = 'banner warn';
    detectedEl.innerHTML = `<strong>Can't reach the Ranch API.</strong> ${escapeHtml(catalogueError)}<br />Hit Disconnect and double-check the API URL.`;
  } else {
    detectedEl.className = 'banner warn';
    detectedEl.innerHTML = `<strong>${escapeHtml(host)}</strong> isn't in the catalogue. "All my agents" needs a known service — pick "Specific agents" to send anyway.`;
  }

  // account label
  const accountKeyEl = $('account-key');
  const accountHintEl = $('account-hint');
  const lastAccountKeys = state.lastAccountKeys ?? {};
  if (service) {
    accountKeyEl.value = lastAccountKeys[service.service] ?? '';
    accountKeyEl.placeholder = service.accountKeyHint ?? 'miybot';
    accountHintEl.textContent =
      service.accountKeyHint ?? 'A friendly name for this account.';
  } else {
    accountKeyEl.placeholder = 'instagram, paypal:main, …';
    accountHintEl.textContent =
      'Profile name agents pass to browser_play(profile: …).';
  }
  // Pre-fill a guess from the page title so the user rarely has to type.
  // Never overwrite a remembered value (lastAccountKeys above).
  if (!accountKeyEl.value) {
    accountKeyEl.value = suggestLabel(tab?.title, host);
  }

  const ctx = { state, host, service, storageStateCookies };
  wireScopeToggle(ctx);
  wireSend(ctx);

  // If the site is unsupported, "All my agents" can't work — pre-select
  // "Specific agents" so the user lands on the only path that will send.
  if (!service) {
    const someRadio = document.querySelector('input[name="scope"][value="some"]');
    someRadio.checked = true;
    someRadio.dispatchEvent(new Event('change', { bubbles: true }));
  }

  accountKeyEl.oninput = () => refreshSendEnabled(ctx);
  refreshSendEnabled(ctx);
}

function currentScope() {
  return document.querySelector('input[name="scope"]:checked')?.value ?? 'all';
}

function selectedAgentIds() {
  return [...document.querySelectorAll('.agent input:checked')].map(
    (el) => el.value,
  );
}

function wireScopeToggle(ctx) {
  const hintEl = $('scope-hint');
  const agentsEl = $('agents');

  const apply = async () => {
    const scope = currentScope();
    setStatus('', 'ok');
    if (scope === 'all') {
      agentsEl.hidden = true;
      hintEl.textContent =
        'Cookies go to your per-user store — every agent you run can use them.';
    } else {
      agentsEl.hidden = false;
      hintEl.textContent = 'Only the agents you tick below will receive these cookies.';
      await renderAgentList(ctx);
    }
    refreshSendEnabled(ctx);
  };

  for (const radio of document.querySelectorAll('input[name="scope"]')) {
    radio.onchange = apply;
  }
}

async function renderAgentList(ctx) {
  const agentsEl = $('agents');

  if (agentsCache) {
    paintAgents(agentsCache, ctx);
    return;
  }

  agentsEl.innerHTML = `<div class="agents-msg"><span class="spinner"></span>Loading agents…</div>`;
  try {
    const jwt = await getAdminJwt(ctx.state.adminUrl);
    if (!jwt) throw new Error('Not signed in to Ranch.');
    const list = await listAgents(ctx.state.apiUrl, jwt);
    if (!Array.isArray(list)) throw new Error('Unexpected response shape.');
    list.sort(
      (a, b) =>
        Number(!!b.isAdmin) - Number(!!a.isAdmin) ||
        String(a.name).localeCompare(String(b.name)),
    );
    agentsCache = list;
    paintAgents(list, ctx);
  } catch (err) {
    agentsEl.innerHTML = `<div class="agents-msg">Couldn't load agents — ${err.message}</div>`;
  }
}

function paintAgents(agents, ctx) {
  const agentsEl = $('agents');
  if (agents.length === 0) {
    agentsEl.innerHTML = `<div class="agents-msg">No agents on this account.</div>`;
    return;
  }
  agentsEl.innerHTML = agents
    .map(
      (a) => `
      <label class="agent">
        <input type="checkbox" value="${a.id}" />
        <span class="name">${escapeHtml(a.name)}</span>
        ${a.isAdmin ? '<span class="badge">admin</span>' : ''}
      </label>`,
    )
    .join('');
  for (const cb of agentsEl.querySelectorAll('input')) {
    cb.onchange = () => refreshSendEnabled(ctx);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[c]));
}

function refreshSendEnabled(ctx) {
  const sendBtn = $('send-btn');
  const hasCookies = ctx.storageStateCookies.length > 0;
  const hasLabel = $('account-key').value.trim().length > 0;
  const scope = currentScope();

  let ok = hasCookies && hasLabel;
  if (scope === 'all') {
    ok = ok && !!ctx.service && !!ctx.state.intToken;
  } else {
    ok = ok && selectedAgentIds().length > 0;
  }

  sendBtn.disabled = !ok;
  if (scope === 'all') {
    sendBtn.textContent = 'Send to all my agents';
  } else {
    const n = selectedAgentIds().length;
    sendBtn.textContent = n > 0 ? `Send to ${n} agent${n === 1 ? '' : 's'}` : 'Send cookies';
  }
}

function wireSend(ctx) {
  $('send-btn').onclick = async () => {
    const scope = currentScope();
    const accountKey = $('account-key').value.trim();
    $('send-btn').disabled = true;
    setStatus('<span class="spinner"></span>Uploading…', 'ok');
    try {
      if (scope === 'all') {
        await sendToAllAgents(ctx, accountKey);
      } else {
        await sendToSpecificAgents(ctx, accountKey);
      }
    } catch (err) {
      setStatus(`Failed: ${err.message}`, 'err');
    } finally {
      refreshSendEnabled(ctx);
    }
  };
}

// "All my agents" → per-user integration store.
async function sendToAllAgents(ctx, accountKey) {
  const { state, service, storageStateCookies } = ctx;
  const res = await fetchJson(`${state.apiUrl}/integrations/extension/import-state`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.intToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      service: service.service,
      accountKey,
      cookies: storageStateCookies,
      origins: [],
      userAgent: navigator.userAgent,
    }),
  });
  await saveState({
    lastAccountKeys: {
      ...(state.lastAccountKeys ?? {}),
      [service.service]: accountKey,
    },
  });
  setStatus(
    `Sent ${res.cookies} cookies to <strong>${service.title}</strong> → "${accountKey}". Every agent can use it via browser_play(profile: "${service.service}:${accountKey}").`,
    'ok',
  );
}

// "Specific agents" → per-agent browser store, one push per agent.
async function sendToSpecificAgents(ctx, accountKey) {
  const { state, service, storageStateCookies } = ctx;
  const agentIds = selectedAgentIds();
  const profile = service ? `${service.service}:${accountKey}` : accountKey;

  const jwt = await getAdminJwt(state.adminUrl);
  if (!jwt) throw new Error('Not signed in to Ranch.');

  const ok = [];
  const failed = [];
  for (const agentId of agentIds) {
    const name = agentsCache?.find((a) => a.id === agentId)?.name ?? agentId;
    try {
      const minted = await mintBrowserToken(state.apiUrl, jwt, agentId);
      await fetchJson(`${state.apiUrl}/browser/extension/import-state`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${minted.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          profile,
          cookies: storageStateCookies,
          origins: [],
          userAgent: navigator.userAgent,
        }),
      });
      ok.push(name);
    } catch (err) {
      failed.push(`${name} (${err.message})`);
    }
  }

  if (failed.length === 0) {
    setStatus(
      `Sent to ${ok.length} agent${ok.length === 1 ? '' : 's'}: ${ok.join(', ')}. Use browser_play(profile: "${profile}").`,
      'ok',
    );
  } else if (ok.length === 0) {
    setStatus(`Failed for all agents — ${failed.join('; ')}`, 'err');
  } else {
    setStatus(
      `Sent to ${ok.join(', ')}. Failed: ${failed.join('; ')}`,
      'err',
    );
  }
}

// ── event wiring (static screens) ────────────────────────────────────

// Probe the active tab. A Ranch admin page carries a
// <meta name="ranch-api-url"> tag (injected by the admin app). If found,
// returns the deployment's URLs + whether the user is already signed in
// there. Returns null for any non-Ranch page.
async function detectRanchTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return null;
    const url = new URL(tab.url);
    if (!/^https?:$/.test(url.protocol)) return null;

    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () =>
        document.querySelector('meta[name="ranch-api-url"]')?.content || null,
    });
    const apiUrl = injected?.result;
    if (!apiUrl) return null; // not a Ranch admin page

    const adminUrl = url.origin;
    const cookie = await chrome.cookies.get({
      url: adminUrl,
      name: 'access_token',
    });
    return { adminUrl, apiUrl, signedIn: !!cookie?.value };
  } catch (err) {
    console.warn('detectRanchTab failed:', err.message);
    return null;
  }
}

// Open the setup screen. Detects whether the active tab is a Ranch admin
// page: if so, shows only the one-click "Use this site" button; if not,
// shows the manual URL form with a tip. Inputs are prefilled from saved
// state so fixing a wrong API URL is a quick edit, not a full re-setup.
async function goSetup() {
  const st = await loadState();
  $('setup-url').value = st.adminUrl ?? '';
  $('setup-api').value = st.apiUrl ?? '';
  // A stored API URL is treated as user-owned — don't auto-overwrite it.
  apiUrlEdited = !!st.apiUrl;
  showScreen('setup');

  $('setup-checking').hidden = false;
  $('detect-block').hidden = true;
  $('manual-block').hidden = true;
  $('setup-tip').hidden = false;

  const found = await detectRanchTab();
  $('setup-checking').hidden = true;

  if (found) {
    $('detect-host').textContent = new URL(found.adminUrl).hostname;
    $('detect-status').textContent = found.signedIn
      ? "You're signed in — connect in one click."
      : 'Sign in on this tab first, then click below.';
    $('detect-use').onclick = async () => {
      await saveState({
        adminUrl: found.adminUrl,
        apiUrl: found.apiUrl,
        catalogue: null,
      });
      await startup();
    };
    $('detect-block').hidden = false;
  } else {
    $('manual-block').hidden = false;
  }
}

// Keep the API URL field mirrored to the admin URL until the user edits
// it by hand — then leave their value alone (needed for localhost, where
// admin and API live on different ports).
$('setup-api').oninput = () => { apiUrlEdited = true; };
$('setup-url').oninput = () => {
  if (apiUrlEdited) return;
  const origin = normalize($('setup-url').value);
  $('setup-api').value = origin ? deriveApiUrl(origin) : '';
};

$('setup-continue').onclick = async () => {
  const adminUrl = normalize($('setup-url').value);
  if (!adminUrl) {
    alert('Enter a valid admin URL, e.g. https://admin.ranch.cleanslice.org');
    return;
  }
  const apiUrl = normalize($('setup-api').value) ?? deriveApiUrl(adminUrl);
  // Clear any cached catalogue — it may belong to a different deployment.
  await saveState({ adminUrl, apiUrl, catalogue: null });
  await startup();
};

$('login-open').onclick = async () => {
  const { adminUrl } = await loadState();
  if (adminUrl) chrome.tabs.create({ url: `${adminUrl}/login` });
};
// Escape hatch from the detected-site card to the manual URL form.
$('detect-manual').onclick = () => {
  $('detect-block').hidden = true;
  $('setup-tip').hidden = true;
  $('manual-block').hidden = false;
};

$('login-retry').onclick = () => startup();
$('login-reset').onclick = () => goSetup();

$('edit-urls').onclick = () => goSetup();

$('disconnect').onclick = async () => {
  await clearState();
  agentsCache = null;
  await goSetup();
};

startup();
