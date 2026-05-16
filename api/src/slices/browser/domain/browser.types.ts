export enum BrowserSessionStatusTypes {
  Idle = 'idle',
  Active = 'active',
  NeedsLogin = 'needs_login',
  Expired = 'expired',
  Stuck = 'stuck',
}

export interface IBrowserSessionData {
  id: string;
  userId: string;
  accountKey: string;
  status: BrowserSessionStatusTypes;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateBrowserSessionData {
  userId: string;
  accountKey: string;
}

// What the runtime needs to actually connect a browser.
// `cdpUrl` carries the user-data-dir launch arg + a single-use token, so
// nothing here should ever leave the trust boundary of an authenticated
// runtime request.
export interface IBrowserSessionConnection {
  session: IBrowserSessionData;
  cdpUrl: string;
  vncUrl: string | null;
}

export interface IFindBrowserSessionsFilter {
  userId: string;
  status?: BrowserSessionStatusTypes;
}
