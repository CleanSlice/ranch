export type IntegrationMechanismTypes = 'browser' | 'secret';

export type IntegrationStatusTypes =
  | 'pending'
  | 'connected'
  | 'needs_login'
  | 'revoked';

/**
 * A service in the static catalogue. Catalogue lives in code (see
 * catalogue.ts) — adding a service is a code change, not a runtime
 * insert. Frontend renders the connect dialog from these fields.
 */
export interface IIntegrationCatalogueItem {
  service: string;
  title: string;
  description: string;
  iconUrl: string;
  mechanism: IntegrationMechanismTypes;
  /** Browser-mechanism: page the pool's Chrome navigates to before VNC. */
  loginUrl?: string;
  /** Browser-mechanism: hint text for the accountKey input ("your IG handle"). */
  accountKeyHint?: string;
  /**
   * Browser-mechanism: domains the Chrome extension auto-matches against
   * the current tab. Suffix-match — `x.com` matches `x.com` AND
   * `mobile.x.com`. Multi-domain entries (e.g. `x` matches `twitter.com`
   * AND `x.com`) belong to the same service.
   */
  domains?: string[];
  /** Secret-mechanism: env var name the runtime exposes to agents. */
  secretEnvKey?: string;
  /** Secret-mechanism: where the user gets the credential, shown under the input. */
  secretHelp?: string;
}

export interface IIntegrationAccountData {
  id: string;
  userId: string;
  service: string;
  accountKey: string;
  mechanism: IntegrationMechanismTypes;
  label: string | null;
  status: IntegrationStatusTypes;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateIntegrationAccountData {
  userId: string;
  service: string;
  accountKey: string;
  mechanism: IntegrationMechanismTypes;
  label?: string | null;
}

export interface IUpdateIntegrationAccountData {
  label?: string | null;
  status?: IntegrationStatusTypes;
}

/**
 * Response shape for POST /integrations/accounts/:id/login.
 *
 * No VNC — the agent forwards `helpUrl` (or, for chat-only channels,
 * the raw `instructions`) to the end user. The user opens the page,
 * follows the steps to install the Ranch Cookies extension if needed,
 * goes to `siteUrl`, logs in, and sends cookies via extension. The
 * IntegrationAccount status flips to "connected" once the extension
 * posts to /integrations/extension/import-state.
 */
export interface ILoginInstructionData {
  accountId: string;
  /** Catalogue's `loginUrl` — direct link to the service's login page. */
  siteUrl: string;
  /** Admin-UI route that walks the user through the connect flow. */
  helpUrl: string;
  /** Plain-text instructions the agent can paraphrase for chat channels
   *  where helpUrl isn't directly clickable. */
  instructions: string;
}
