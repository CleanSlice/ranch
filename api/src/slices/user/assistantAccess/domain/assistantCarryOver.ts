import { UserRoleTypes } from '#/user/user/domain/user.types';
import {
  ASSISTANT_ROLE_DEFAULTS,
  isAssistantRole,
  type AssistantLevelOrCustom,
} from './assistantAccess.types';

/**
 * The move of the assistant out of the agent access lists (CLEAN-240,
 * FR-030), as a function. The migration does this in SQL; this is the same
 * rule where a spec can hold it, and the two are kept side by side.
 *
 * - Denied stays off: an exception with the role's default level, so that
 *   switching it back on gives the account what its role gets.
 * - Allowed, or left out of an Allowed list of other agents: nothing is
 *   written. On is the default, and the Owner never chose to take it away.
 * - Every entry that names the assistant goes. `limited` is not touched.
 */
export interface ICarryOverEntry {
  userId: string;
  agentId: string;
  list: 'allowed' | 'denied';
}

export interface ICarryOverResult {
  /** Accounts that end with the assistant off. */
  exceptions: {
    userId: string;
    enabled: false;
    level: AssistantLevelOrCustom;
  }[];
  /** The lists without the assistant. */
  entries: ICarryOverEntry[];
}

export function carryOver(
  entries: readonly ICarryOverEntry[],
  assistantId: string | null,
  roleOf: (userId: string) => UserRoleTypes | null,
): ICarryOverResult {
  if (assistantId === null) return { exceptions: [], entries: [...entries] };

  const exceptions: ICarryOverResult['exceptions'] = [];
  for (const entry of entries) {
    if (entry.agentId !== assistantId || entry.list !== 'denied') continue;
    const role = roleOf(entry.userId);
    // The Owner has no setting, and an account that is gone has no row.
    if (!isAssistantRole(role)) continue;
    exceptions.push({
      userId: entry.userId,
      enabled: false,
      level: ASSISTANT_ROLE_DEFAULTS[role].level,
    });
  }
  return {
    exceptions,
    entries: entries.filter((entry) => entry.agentId !== assistantId),
  };
}
