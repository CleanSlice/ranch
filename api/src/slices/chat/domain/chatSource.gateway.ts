import {
  ICitationGroup,
  ICitationRange,
  ICitedAnswer,
  ICreateChatMessageSource,
  IChatMessageSourceData,
} from './chatSource.types';

export abstract class IChatSourceGateway {
  /** Upsert on `(messageId, n)`: a replayed event rewrites, never duplicates. */
  abstract upsertMany(rows: ICreateChatMessageSource[]): Promise<void>;
  abstract findByMessageIds(
    messageIds: string[],
  ): Promise<IChatMessageSourceData[]>;
  abstract findOne(
    agentId: string,
    messageId: string,
    n: number,
  ): Promise<IChatMessageSourceData | null>;

  // The three reads of a statistics view (CLEAN-258). The first two are one
  // range of the index on `[clientId, createdAt]` each, grouped by the
  // database: what comes back is as large as the answers and the sources of
  // that person's period, never as the table.

  /** The answers that cited something in the range, oldest first. */
  abstract findCitedAnswers(range: ICitationRange): Promise<ICitedAnswer[]>;

  /** The range's citations counted per knowledge base, and for the web. */
  abstract countCitationsBySource(
    range: ICitationRange,
  ): Promise<ICitationGroup[]>;

  /** When the earliest citation there is was recorded; null when none was. */
  abstract firstCreatedAt(): Promise<Date | null>;
}

/**
 * The knowledge slice's answer to "may this person rate / did they rate".
 * Declared here because the chat slice is the consumer; the provider is bound
 * by the source module once ratings exist (CLEAN-138, US4). Optional until
 * then — a history view without it simply shows no rating.
 */
export abstract class ISourceRatingReader {
  /** `${messageId}:${sourceId}` → the author's current verdict. */
  abstract mine(
    messageIds: string[],
    authorId: string,
  ): Promise<Record<string, 1 | -1>>;
}
