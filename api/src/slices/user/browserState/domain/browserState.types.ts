/**
 * Playwright storageState cookie shape — identical to what
 * `browser/dtos/importState.dto.ts` consumes, kept local here to avoid
 * a cross-slice dependency.
 */
export interface IUserBrowserStateCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface IUserBrowserStateOrigin {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
}

/**
 * Wrapped storage state — same envelope shape the runtime's
 * playwright.repository.ts already understands (`{userAgent, storageState}`
 * or legacy plain `{cookies, origins}`).
 */
export interface IUserBrowserStatePayload {
  userAgent?: string;
  storageState: {
    cookies: IUserBrowserStateCookie[];
    origins: IUserBrowserStateOrigin[];
  };
}
