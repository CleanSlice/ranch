import { Injectable } from '@nestjs/common';
import { ISourceRatingReader } from '#/chat/domain/chatSource.gateway';
import { ISourceRatingGateway } from './sourceRating.gateway';
import type { ISourceRatingData, IRateSourceInput } from './source.types';

/**
 * A reader's verdict on a knowledge source as it was used in one answer
 * (CLEAN-138). The service owns the rating itself; whether the caller may
 * rate — "was this cited to you?" — is the chat slice's question, answered
 * by `ChatSourceService.isCitedTo` before anything reaches here, so this
 * slice never has to look into a conversation.
 *
 * One row per (source, message, author); a flip updates it, a withdrawal
 * deletes it, so counting rows is counting current verdicts (FR-031).
 */
@Injectable()
export class SourceRatingService extends ISourceRatingReader {
  constructor(private readonly gateway: ISourceRatingGateway) {
    super();
  }

  rate(input: IRateSourceInput): Promise<ISourceRatingData> {
    return this.gateway.upsert(input);
  }

  /** Idempotent: withdrawing a rating that is not there is not an error. */
  unrate(sourceId: string, messageId: string, authorId: string): Promise<void> {
    return this.gateway.delete(sourceId, messageId, authorId);
  }

  async mine(
    messageIds: string[],
    authorId: string,
  ): Promise<Record<string, 1 | -1>> {
    if (messageIds.length === 0 || !authorId) return {};
    const rows = await this.gateway.findByAuthor(messageIds, authorId);
    const out: Record<string, 1 | -1> = {};
    for (const r of rows) out[`${r.messageId}:${r.sourceId}`] = r.rating;
    return out;
  }
}
