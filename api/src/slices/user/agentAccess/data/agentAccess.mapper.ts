import { Injectable } from '@nestjs/common';
import type {
  AgentAccessListTypes,
  IAgentAccessEntry,
  IAgentAccessState,
} from '../domain/agentAccess.types';

/** One row of the account-with-entries read: the account, and one entry or none. */
export interface IAgentAccessRow {
  userId: string;
  limited: boolean;
  updatedAt: Date;
  agentId: string | null;
  list: string | null;
}

const isList = (value: unknown): value is AgentAccessListTypes =>
  value === 'allowed' || value === 'denied';

@Injectable()
export class AgentAccessMapper {
  /**
   * The rows of one account as its state. No row at all is an account
   * nobody ever edited: not limited, no entries, no version.
   */
  toState(userId: string, rows: IAgentAccessRow[]): IAgentAccessState {
    if (rows.length === 0) {
      return { userId, limited: false, entries: [], updatedAt: null };
    }
    const entries: IAgentAccessEntry[] = [];
    for (const row of rows) {
      // A list this code does not know is no permission and no denial it
      // can name; it is left out rather than guessed at.
      if (row.agentId && isList(row.list)) {
        entries.push({ agentId: row.agentId, list: row.list });
      }
    }
    return {
      userId,
      limited: rows[0].limited === true,
      entries,
      updatedAt: new Date(rows[0].updatedAt),
    };
  }
}
