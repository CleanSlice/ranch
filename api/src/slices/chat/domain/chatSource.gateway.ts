import {
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
