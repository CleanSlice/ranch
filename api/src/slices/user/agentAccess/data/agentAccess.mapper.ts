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

/**
 * One row of the read that starts from the account itself: no row at all
 * means there is no such account; a row with no `updatedAt` an account whose
 * access nobody edited.
 */
export interface IAccountAccessRow {
  userId: string;
  limited: boolean | null;
  updatedAt: Date | null;
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
  /**
   * The same, read from the account's side. An account that does not exist
   * is told apart from one nobody edited: the first reaches nothing.
   */
  toAccountState(
    userId: string,
    rows: IAccountAccessRow[],
  ): IAgentAccessState {
    if (rows.length === 0) {
      return {
        userId,
        limited: false,
        entries: [],
        updatedAt: null,
        accountMissing: true,
      };
    }
    const edited = rows.filter(
      (row): row is IAccountAccessRow & { updatedAt: Date } =>
        row.updatedAt !== null,
    );
    return this.toState(
      userId,
      edited.map((row) => ({ ...row, limited: row.limited === true })),
    );
  }

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
