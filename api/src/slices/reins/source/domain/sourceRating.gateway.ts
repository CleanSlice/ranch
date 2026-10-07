import type { ISourceRatingData, IRateSourceInput } from './source.types';

export abstract class ISourceRatingGateway {
  /** Upsert on `(sourceId, messageId, authorId)`. */
  abstract upsert(input: IRateSourceInput): Promise<ISourceRatingData>;
  abstract delete(
    sourceId: string,
    messageId: string,
    authorId: string,
  ): Promise<void>;
  abstract findByAuthor(
    messageIds: string[],
    authorId: string,
  ): Promise<ISourceRatingData[]>;
}
