import {
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import {
  ChatSourceService,
  type IChatMessageSourceData,
  type IChatSourceViewer,
} from '#/chat/domain';
import { IKnowledgeGateway } from '#/reins/knowledge/domain/knowledge.gateway';
import { ISourceGateway } from '#/reins/source/domain/source.gateway';
import { SourceRatingService } from '#/reins/source/domain/sourceRating.service';
import type { ISourceContent } from '#/reins/source/domain/source.types';

/** Why a reader-facing source request was refused; the consoles map these to copy. */
export const SourceAccessErrorCodes = {
  /** The base's keeper has not opened its documents to readers. */
  ReaderAccessClosed: 'READER_ACCESS_CLOSED',
  /** The knowledge source was deleted after it was cited. */
  SourceGone: 'SOURCE_GONE',
} as const;

/**
 * A stored text file carries its MIME type without a charset, and a browser
 * shown `text/plain` alone guesses the encoding from its locale — a Cyrillic
 * document opened in a new tab came out as mojibake. Everything this API
 * stores as text is UTF-8, so say so.
 */
export function contentTypeForBrowser(contentType: string): string {
  const [type] = contentType.split(';');
  const bare = type.trim().toLowerCase();
  const hasCharset = /;\s*charset=/i.test(contentType);
  return bare.startsWith('text/') && !hasCharset
    ? `${bare}; charset=utf-8`
    : contentType;
}

/**
 * What a reader may do with a cited source (CLEAN-138): open the document,
 * rate it. Every path starts from the same question — "was `(messageId, n)`
 * cited to you?" — asked of the chat slice, so a source id is never an
 * address a reader can guess; then the knowledge side's policy and the
 * source's existence are read at request time, never from the row.
 *
 * 404, not 403, when the citation is not the reader's: the route must not
 * confirm that a citation exists for someone else.
 */
@Injectable()
export class SourceAccessService {
  constructor(
    @Inject(forwardRef(() => ChatSourceService))
    private readonly citations: ChatSourceService,
    @Inject(forwardRef(() => IKnowledgeGateway))
    private readonly knowledges: IKnowledgeGateway,
    @Inject(forwardRef(() => ISourceGateway))
    private readonly sources: ISourceGateway,
    @Inject(forwardRef(() => SourceRatingService))
    private readonly ratings: SourceRatingService,
  ) {}

  /** The document behind a cited knowledge source, for a reader allowed to open it. */
  async openCited(
    agentId: string,
    messageId: string,
    n: number,
    viewer: IChatSourceViewer,
  ): Promise<ISourceContent> {
    const row = await this.requireKnowledgeCitation(agentId, messageId, n, viewer);
    const source = await this.sources.findById(row.sourceId);
    if (!source) throw this.notFound(messageId, n);
    if (!viewer.isAdmin) {
      // Read now, not when the row was written: closing a base must close
      // every answer that cited it, including links handed out earlier.
      const [base] = await this.knowledges.findExistingByIds([source.knowledgeId]);
      if (base?.readerAccess !== 'open') {
        throw new ForbiddenException({
          code: SourceAccessErrorCodes.ReaderAccessClosed,
          message: 'This knowledge base does not let readers open its documents.',
        });
      }
    }
    return this.sources.readContent(source);
  }

  /** Like / dislike a cited knowledge source; one verdict per reader and answer. */
  async rateCited(
    agentId: string,
    messageId: string,
    n: number,
    viewer: IChatSourceViewer,
    rating: 1 | -1,
  ): Promise<{ rating: 1 | -1 }> {
    const row = await this.requireKnowledgeCitation(agentId, messageId, n, viewer);
    const saved = await this.ratings.rate({
      sourceId: row.sourceId,
      messageId,
      authorId: viewer.clientId,
      rating,
    });
    return { rating: saved.rating };
  }

  /** Withdraw the reader's rating. Nothing to withdraw is not an error. */
  async unrateCited(
    agentId: string,
    messageId: string,
    n: number,
    viewer: IChatSourceViewer,
  ): Promise<void> {
    const row = await this.requireKnowledgeCitation(agentId, messageId, n, viewer);
    await this.ratings.unrate(row.sourceId, messageId, viewer.clientId);
  }

  /**
   * The citation row, provided it is a knowledge source that still exists
   * and was cited to this viewer. A web source is opened by its address and
   * cannot be rated, so for these purposes it is "not found" too.
   */
  private async requireKnowledgeCitation(
    agentId: string,
    messageId: string,
    n: number,
    viewer: IChatSourceViewer,
  ): Promise<IChatMessageSourceData & { sourceId: string }> {
    const row = await this.citations.isCitedTo(agentId, messageId, n, viewer);
    if (!row || row.kind !== 'knowledge') throw this.notFound(messageId, n);
    if (!row.sourceId) {
      throw new GoneException({
        code: SourceAccessErrorCodes.SourceGone,
        message: 'This document is no longer in the knowledge base.',
      });
    }
    return { ...row, sourceId: row.sourceId };
  }

  private notFound(messageId: string, n: number): NotFoundException {
    return new NotFoundException(`Source ${n} of message ${messageId} not found`);
  }
}
