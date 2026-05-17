// Popup UI controller. Talks to chrome.storage.local for connection
// settings, chrome.cookies for the current tab's cookies, and the Ranch
// API for the actual upload.

const $ = (id) => document.getElementById(id);

const profileEl = $('profile');
const apiUrlEl = $('api-url');
const tokenEl = $('token');
const sendBtn = $('send-btn');
const saveConnBtn = $('save-conn-btn');
const settingsBtn = $('settings-btn');
const statusEl = $('status');
const emptyState = $('empty-state');
const currentSite = $('current-site');
const domainLabel = $('domain-label');
const cookieCount = $('cookie-count');

let activeTab = null;
let cookiesForSite = [];

const STORAGE_KEY = 'ranch-cookies-settings:v1';

function setStatus(msg, kind) {
  if (!msg) {
    statusEl.hidden = true;
    return;
  }
  statusEl.textContent = msg;
  statusEl.className = 'status ' + kind;
  statusEl.hidden = false;
}

function updateSendEnabled() {
  const ready =
    activeTab &&
    cookiesForSite.length > 0 &&
    profileEl.value.trim().length > 0 &&
    apiUrlEl.value.trim().length > 0 &&
    tokenEl.value.trim().length > 0;
  sendBtn.disabled = !ready;
}

// Cookies live on the registrable domain (e.g. `.instagram.com`). Filtering
// by URL hostname misses the leading-dot variants Chrome stores for
// HttpOnly/secure cookies — `chrome.cookies.getAll({ domain })` is the
// right surface here.
async function loadCookiesForTab(tab) {
  cookiesForSite = [];
  if (!tab?.url) return;
  try {
    const url = new URL(tab.url);
    if (!/^https?:$/.test(url.protocol)) {
      domainLabel.textContent = '(non-http page)';
      cookieCount.textContent = 'Open the site you want to export, then reopen this popup.';
      return;
    }
    domainLabel.textContent = url.hostname;
    // strip a leading "www." so we capture the apex cookies too — Chrome
    // returns subdomain matches automatically.
    const apex = url.hostname.replace(/^www\./, '');
    const cookies = await chrome.cookies.getAll({ domain: apex });
    cookiesForSite = cookies;
    cookieCount.textContent =
      cookies.length === 0
        ? 'No cookies stored for this site yet. Log in first, then click again.'
        : `${cookies.length} cookies found.`;
  } catch (err) {
    domainLabel.textContent = '(error)';
    cookieCount.textContent = String(err.message || err);
  }
}

// CDP / Playwright storageState expects sameSite values "Strict" | "Lax" |
// "None". chrome.cookies returns lowercase ("strict") + the special
// "unspecified" / "no_restriction" values. Normalize at the boundary so
// the runtime can drop the file straight into `chromium.launch({
// storageState })`.
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
    // Session cookies have no expirationDate from Chrome — Playwright
    // expects -1 for those.
    expires: typeof c.expirationDate === 'number' ? Math.floor(c.expirationDate) : -1,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: normalizeSameSite(c.sameSite),
  }));
}

async function loadSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const s = data[STORAGE_KEY] ?? {};
  apiUrlEl.value = s.apiUrl ?? '';
  tokenEl.value = s.token ?? '';
  profileEl.value = s.lastProfile ?? '';
  const connConfigured = !!(s.apiUrl && s.token);
  emptyState.hidden = connConfigured;
  currentSite.hidden = !connConfigured;
  // Auto-expand the connection panel until first save.
  if (!connConfigured) document.querySelector('details').open = true;
}

async function saveSettings(patch) {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const merged = { ...(data[STORAGE_KEY] ?? {}), ...patch };
  await chrome.storage.local.set({ [STORAGE_KEY]: merged });
}

async function sendCookies() {
  setStatus('Uploading…', 'ok');
  sendBtn.disabled = true;
  try {
    const apiUrl = apiUrlEl.value.trim().replace(/\/+$/, '');
    const token = tokenEl.value.trim();
    const profile = profileEl.value.trim();
    const cookies = toStorageStateCookies(cookiesForSite);

    const res = await fetch(`${apiUrl}/browser/sessions/import-state`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profile,
        // localStorage is intentionally omitted — the agent's existing
        // `storageState` consumer only restores cookies anyway, and
        // reading localStorage per-origin from the extension would
        // require a content script injected into each origin we touched.
        cookies,
        origins: [],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    await saveSettings({ lastProfile: profile });
    setStatus(
      `Sent ${cookies.length} cookies to profile "${profile}". ` +
        (data?.data?.path ? `(${data.data.path})` : ''),
      'ok',
    );
  } catch (err) {
    setStatus(`Failed: ${err.message ?? err}`, 'err');
  } finally {
    updateSendEnabled();
  }
}

sendBtn.addEventListener('click', sendCookies);
saveConnBtn.addEventListener('click', async () => {
  await saveSettings({
    apiUrl: apiUrlEl.value.trim().replace(/\/+$/, ''),
    token: tokenEl.value.trim(),
  });
  await loadSettings();
  setStatus('Connection saved.', 'ok');
});
settingsBtn.addEventListener('click', () => {
  document.querySelector('details').open = true;
  apiUrlEl.focus();
});
profileEl.addEventListener('input', updateSendEnabled);
apiUrlEl.addEventListener('input', updateSendEnabled);
tokenEl.addEventListener('input', updateSendEnabled);

(async () => {
  await loadSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  await loadCookiesForTab(tab);
  updateSendEnabled();
})();
