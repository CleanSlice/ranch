const VISITOR_KEY = 'bridle:share:visitor';

/**
 * The same rule the API applies (`sanitizeAnonId`): anything else is rejected
 * with 403, so a value that fails this never leaves the browser.
 */
const VISITOR_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** 22 chars × 6 bits = 132 bits — comfortably unguessable, still short. */
const VISITOR_LENGTH = 22;

/** base64url alphabet; 64 symbols, so a byte maps onto it without bias. */
const BASE64URL =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Survives a browser that refuses storage: the id is minted once per page load
 * and reused from here, so a private-mode visitor keeps one conversation for as
 * long as the tab lives instead of starting a new one on every send.
 */
let cached: string | null = null;

function mint(): string {
  const bytes = new Uint8Array(VISITOR_LENGTH);
  const webCrypto = globalThis.crypto;
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
  } else {
    // No WebCrypto (ancient browser, exotic embedding): a weaker id still keeps
    // the conversation working, and the id is not a credential — the share
    // token is.
    for (let i = 0; i < VISITOR_LENGTH; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = '';
  for (let i = 0; i < VISITOR_LENGTH; i += 1) {
    out += BASE64URL[(bytes[i] ?? 0) % 64];
  }
  return out;
}

function read(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(VISITOR_KEY);
    // A hand-edited or truncated value would be refused by the API, so treat
    // anything off-pattern as absent and mint a fresh id over it.
    return stored && VISITOR_PATTERN.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

function write(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VISITOR_KEY, id);
  } catch {
    // Quota or private mode — the in-memory cache carries the id for this tab;
    // the visitor loses their history on reload, nothing else.
  }
}

/**
 * The stable per-browser identity of a share-link visitor.
 *
 * Minted on the first visit to any share link and reused for every link in that
 * browser, which is what makes a visitor's conversation survive a reload
 * (FR-011). The server turns it into `clientId = share-<visitorId>`; losing
 * browser storage loses the conversation on the visitor's side only.
 *
 * Always returns a string matching `/^[A-Za-z0-9_-]{1,64}$/`, including when
 * `localStorage` throws.
 */
export function useShareVisitorId(): string {
  if (cached) return cached;
  const stored = read();
  if (stored) {
    cached = stored;
    return cached;
  }
  const minted = mint();
  write(minted);
  cached = minted;
  return cached;
}
