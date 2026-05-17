// Popup controller. State machine: setup → login → pick-agent → ready.
//
// The flow auto-derives almost everything from the Ranch admin URL the
// user pastes once:
//   - Admin URL (e.g. https://admin.ranch.cleanslice.org) — we read the
//     `access_token` cookie from this origin using chrome.cookies.get.
//   - API URL — derived by swapping the leading "admin." host segment
//     for "api." (the cleanslice convention). If that produces a
//     different host the user can override later via the URL prompt.
//   - Agent list — pulled from GET /agents using the admin JWT as Bearer.
//   - Agent ID + userId chosen by the user from the list.
//   - Extension token — minted server-side at /browser/extension/token
//     with the admin JWT, scoped to the chosen agent + userId. Stored
//     in chrome.storage.local for subsequent cookie uploads.

const STORE_KEY = 'ranch-cookies:v2';
const $ = (id) => document.getElementById(id);

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
// admin host doesn't start with `admin.`, fall back to the same origin
// and let the user paste an API URL separately later. Most installs use
// the convention.
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
  // chrome.cookies.get is name-scoped to a host. Nuxt's `useCookie` sets
  // the cookie path-agnostic so the host match alone is enough.
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
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const body = await res.json();
  // ranch-api wraps responses in `{success, data}`; pass either shape through.
  return body?.data ?? body;
}

async function listAgents(apiUrl, jwt) {
  return fetchJson(`${apiUrl}/agents`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
}

async function mintExtensionToken(apiUrl, jwt, agentId, userId) {
  return fetchJson(`${apiUrl}/browser/extension/token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ agentId, userId, ttlDays: 365 }),
  });
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

// ── ui rendering ─────────────────────────────────────────────────────

function showScreen(name) {
  for (const s of ['setup', 'login', 'agent', 'main']) {
    $(`screen-${s}`).hidden = s !== name;
  }
}

function setStatus(msg, kind) {
  const el = $('status');
  if (!msg) {
    el.hidden = true;
    return;
  }
  el.textContent = msg;
  el.className = 'status ' + kind;
  el.hidden = false;
}

// ── controllers per screen ───────────────────────────────────────────

async function startup() {
  const state = await loadState();
  if (!state.adminUrl) return showScreen('setup');

  const jwt = await getAdminJwt(state.adminUrl);
  if (!jwt) {
    $('login-host').textContent = new URL(state.adminUrl).hostname;
    return showScreen('login');
  }

  if (!state.extToken || !state.agentId) {
    return await renderAgentPicker(state.adminUrl, jwt);
  }

  // Refresh: make sure the token is still parseable / not obviously expired.
  // We don't try to verify the signature in the popup — the server does that.
  if (state.exp && state.exp * 1000 < Date.now() + 60_000) {
    return await renderAgentPicker(state.adminUrl, jwt);
  }

  return await renderMain(state);
}

async function renderAgentPicker(adminUrl, jwt) {
  showScreen('agent');
  const apiUrl = deriveApiUrl(adminUrl);
  const sel = $('agent-select');
  sel.innerHTML = '<option>Loading…</option>';
  sel.disabled = true;

  let agents;
  try {
    agents = await listAgents(apiUrl, jwt);
  } catch (err) {
    sel.innerHTML = `<option>Failed: ${err.message.slice(0, 80)}</option>`;
    return;
  }
  if (!Array.isArray(agents) || agents.length === 0) {
    sel.innerHTML = '<option>No agents found for this account</option>';
    return;
  }

  sel.disabled = false;
  // Sort admin agent to the top — that's the most common pick.
  agents.sort((a, b) => Number(!!b.isAdmin) - Number(!!a.isAdmin) || a.name.localeCompare(b.name));
  sel.innerHTML = agents
    .map(
      (a) =>
        `<option value="${a.id}">${a.isAdmin ? '★ ' : ''}${a.name} — ${a.id.slice(0, 12)}…</option>`,
    )
    .join('');

  $('agent-pick').onclick = async () => {
    const agentId = sel.value;
    const userId = $('agent-user').value.trim() || 'admin';
    $('agent-pick').disabled = true;
    try {
      const minted = await mintExtensionToken(apiUrl, jwt, agentId, userId);
      const agentName = agents.find((a) => a.id === agentId)?.name ?? agentId;
      const state = await saveState({
        adminUrl,
        apiUrl,
        extToken: minted.token,
        exp: minted.exp,
        agentId,
        agentName,
        userId,
      });
      await renderMain(state);
    } catch (err) {
      $('agent-pick').disabled = false;
      alert(`Could not mint token:\n${err.message}`);
    }
  };
}

async function renderMain(state) {
  showScreen('main');
  $('connected-summary').textContent = `${state.agentName ?? state.agentId}  ·  user=${state.userId}`;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { host, cookies } = await readCookiesForTab(tab);
  $('site-host').textContent = host;
  $('site-cookies').textContent =
    cookies.length === 0
      ? 'No cookies stored for this site yet. Log in first, then click again.'
      : `${cookies.length} cookies found.`;

  const profileEl = $('profile');
  const sendBtn = $('send-btn');
  profileEl.value = '';
  const updateEnabled = () => {
    sendBtn.disabled = cookies.length === 0 || profileEl.value.trim().length === 0;
  };
  profileEl.oninput = updateEnabled;
  updateEnabled();

  sendBtn.onclick = async () => {
    const profile = profileEl.value.trim();
    sendBtn.disabled = true;
    setStatus('Uploading…', 'ok');
    try {
      const payload = {
        profile,
        cookies: toStorageStateCookies(cookies),
        origins: [],
      };
      const res = await fetchJson(`${state.apiUrl}/browser/extension/import-state`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.extToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      setStatus(
        `Sent ${res.cookies} cookies to "${profile}" (${res.path}). Run browser_play(profile: "${profile}") in your agent.`,
        'ok',
      );
    } catch (err) {
      setStatus(`Failed: ${err.message}`, 'err');
    } finally {
      updateEnabled();
    }
  };
}

// ── event wiring ─────────────────────────────────────────────────────

$('setup-continue').onclick = async () => {
  const origin = normalize($('setup-url').value);
  if (!origin) {
    alert('Enter a valid http(s) URL, e.g. https://admin.ranch.cleanslice.org');
    return;
  }
  await saveState({ adminUrl: origin, apiUrl: deriveApiUrl(origin) });
  await startup();
};

$('login-open').onclick = async () => {
  const { adminUrl } = await loadState();
  if (adminUrl) chrome.tabs.create({ url: `${adminUrl}/login` });
};
$('login-retry').onclick = () => startup();
$('login-reset').onclick = async () => {
  await clearState();
  showScreen('setup');
};

$('agent-reset').onclick = async () => {
  await clearState();
  showScreen('setup');
};

$('disconnect').onclick = async () => {
  await clearState();
  showScreen('setup');
};

startup();
