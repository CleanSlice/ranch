// Domain types for one account's agent access (CLEAN-231, spec 032).
import type { IAccessOutcome } from '../utils/outcome';

export type {
  AccessChoice,
  AccessOutcomeKind,
  IAccessOutcome,
} from '../utils/outcome';

/**
 * One account's access as the signed-in viewer may see it. `allowed` and
 * `denied` hold only agents the viewer reaches; `hasEntriesOutsideView` says
 * there is more, without naming it.
 */
export interface IAgentAccessData {
  userId: string;
  allowed: string[];
  denied: string[];
  outcome: IAccessOutcome;
  needsReview: boolean;
  hasEntriesOutsideView: boolean;
  /** Sent back with a save; null for an account never edited. */
  version: string | null;
}

/** The whole desired state inside the viewer's view. */
export interface ISetAgentAccessInput {
  allowed: string[];
  denied: string[];
  version: string | null;
  /** Required to turn a limited account into an open one. */
  confirmOpen?: boolean;
}

/** The refusals of `/users/:id/agent-access` (contracts/http-api.md). */
export enum AgentAccessRefusalCodes {
  NotEditable = 'ACCESS_NOT_EDITABLE',
  ListsOverlap = 'ACCESS_LISTS_OVERLAP',
  ExceedsCeiling = 'ACCESS_EXCEEDS_CEILING',
  OpenNeedsConfirm = 'ACCESS_OPEN_NEEDS_CONFIRM',
  Changed = 'ACCESS_CHANGED',
}

/**
 * A read or a save the API refused. `message` is the server's sentence, kept
 * as received; `code` is null for an answer that carries none (an unknown
 * agent or account, a network failure).
 */
export class AgentAccessRefusal extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number | null,
    /** With ACCESS_OPEN_NEEDS_CONFIRM: what the change would come to. */
    readonly outcome: IAccessOutcome | null = null,
  ) {
    super(message);
    this.name = 'AgentAccessRefusal';
  }
}

/** The refusal behind a thrown value, or null when it is something else. */
export function asAgentAccessRefusal(error: unknown): AgentAccessRefusal | null {
  return error instanceof AgentAccessRefusal ? error : null;
}
