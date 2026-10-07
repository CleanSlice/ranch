import {
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'stream';
import { SourceAccessService } from './sourceAccess.service';
import type { ChatSourceService, IChatMessageSourceData } from '#/chat/domain';
import type { IKnowledgeGateway } from '#/reins/knowledge/domain/knowledge.gateway';
import type { ISourceGateway } from '#/reins/source/domain/source.gateway';
import type { SourceRatingService } from '#/reins/source/domain/sourceRating.service';

/**
 * The reader-facing gate (CLEAN-138): a document opens only for the reader
 * it was cited to, only while its base is open, and only while it exists.
 * The same gate guards rating. The policy is read on every call.
 */

const row = (over: Partial<IChatMessageSourceData> = {}): IChatMessageSourceData => ({
  id: 'r1',
  agentId: 'agent-1',
  clientId: 'user-1',
  sessionKey: 'bridle:user-1',
  messageId: 'm1',
  n: 1,
  kind: 'knowledge',
  sourceId: 's1',
  knowledgeId: 'k1',
  knowledgeName: 'Legal',
  name: 'Contract.pdf',
  url: null,
  createdAt: new Date(0),
  ...over,
});

const reader = { clientId: 'user-1', isAdmin: false };
const admin = { clientId: 'admin', isAdmin: true };

function harness(opts: {
  cited?: IChatMessageSourceData | null;
  access?: 'open' | 'closed';
  sourceExists?: boolean;
} = {}) {
  const cited = opts.cited === undefined ? row() : opts.cited;
  const citations = {
    isCitedTo: jest.fn(async (_a: string, _m: string, _n: number, viewer: { clientId: string; isAdmin: boolean }) =>
      cited && (viewer.isAdmin || cited.clientId === viewer.clientId) ? cited : null,
    ),
  } as unknown as ChatSourceService;
  const knowledges = {
    findExistingByIds: jest.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, name: `Base ${id}`, readerAccess: opts.access ?? 'closed' })),
    ),
  } as unknown as IKnowledgeGateway;
  const body = Readable.from(['bytes']);
  const sources = {
    findById: jest.fn(async (id: string) =>
      opts.sourceExists === false ? null : { id, knowledgeId: 'k1', name: 'Contract.pdf' },
    ),
    readContent: jest.fn(async () => ({
      filename: 'Contract.pdf',
      contentType: 'application/pdf',
      contentLength: 5,
      body,
    })),
  } as unknown as ISourceGateway;
  const ratings = {
    rate: jest.fn(async (i: { rating: 1 | -1 }) => ({ rating: i.rating })),
    unrate: jest.fn(async () => undefined),
  } as unknown as SourceRatingService;
  const service = new SourceAccessService(citations, knowledges, sources, ratings);
  return { service, citations, knowledges, sources, ratings };
}

describe('SourceAccessService.openCited', () => {
  it('streams the document to the reader it was cited to when the base is open', async () => {
    const { service, sources } = harness({ access: 'open' });
    const content = await service.openCited('agent-1', 'm1', 1, reader);
    expect(content.filename).toBe('Contract.pdf');
    expect(sources.readContent).toHaveBeenCalledTimes(1);
  });

  it('answers 404 for another reader, another agent, or a number never cited', async () => {
    const { service, sources } = harness({ access: 'open' });
    await expect(service.openCited('agent-1', 'm1', 1, { clientId: 'user-2', isAdmin: false })).rejects.toBeInstanceOf(NotFoundException);
    const none = harness({ cited: null, access: 'open' });
    await expect(none.service.openCited('agent-1', 'm1', 2, reader)).rejects.toBeInstanceOf(NotFoundException);
    expect(sources.readContent).not.toHaveBeenCalled();
  });

  it('answers 403 READER_ACCESS_CLOSED while the base is closed — read on every call', async () => {
    const { service, knowledges, sources } = harness({ access: 'closed' });
    const err = await service.openCited('agent-1', 'm1', 1, reader).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'READER_ACCESS_CLOSED' });
    expect(knowledges.findExistingByIds).toHaveBeenCalledWith(['k1']);
    expect(sources.readContent).not.toHaveBeenCalled();
  });

  it('opens for the admin whatever the policy says', async () => {
    const { service, knowledges } = harness({ access: 'closed' });
    await expect(service.openCited('agent-1', 'm1', 1, admin)).resolves.toBeDefined();
    expect(knowledges.findExistingByIds).not.toHaveBeenCalled();
  });

  it('a web source is not a document: 404', async () => {
    const { service } = harness({ cited: row({ kind: 'web', sourceId: null, url: 'https://x.io' }), access: 'open' });
    await expect(service.openCited('agent-1', 'm1', 1, reader)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a deleted source is gone, not missing: 410 SOURCE_GONE', async () => {
    const { service } = harness({ cited: row({ sourceId: null }), access: 'open' });
    const err = await service.openCited('agent-1', 'm1', 1, reader).catch((e) => e);
    expect(err).toBeInstanceOf(GoneException);
    expect((err as GoneException).getResponse()).toMatchObject({ code: 'SOURCE_GONE' });
  });
});

describe('SourceAccessService — rating goes through the same gate', () => {
  it('rates and withdraws for the reader it was cited to, under their own identity', async () => {
    const { service, ratings } = harness();
    expect(await service.rateCited('agent-1', 'm1', 1, reader, -1)).toEqual({ rating: -1 });
    expect(ratings.rate).toHaveBeenCalledWith({ sourceId: 's1', messageId: 'm1', authorId: 'user-1', rating: -1 });
    await service.unrateCited('agent-1', 'm1', 1, reader);
    expect(ratings.unrate).toHaveBeenCalledWith('s1', 'm1', 'user-1');
  });

  it('refuses another reader (404), a web source (404) and a deleted source (410)', async () => {
    const { service, ratings } = harness();
    await expect(service.rateCited('agent-1', 'm1', 1, { clientId: 'user-2', isAdmin: false }, 1)).rejects.toBeInstanceOf(NotFoundException);
    const web = harness({ cited: row({ kind: 'web', sourceId: null, url: 'https://x.io' }) });
    await expect(web.service.rateCited('agent-1', 'm1', 1, reader, 1)).rejects.toBeInstanceOf(NotFoundException);
    const gone = harness({ cited: row({ sourceId: null }) });
    await expect(gone.service.rateCited('agent-1', 'm1', 1, reader, 1)).rejects.toBeInstanceOf(GoneException);
    expect(ratings.rate).not.toHaveBeenCalled();
  });

  it('does not ask the policy: a closed base can still be rated', async () => {
    const { service, knowledges } = harness({ access: 'closed' });
    await service.rateCited('agent-1', 'm1', 1, reader, 1);
    expect(knowledges.findExistingByIds).not.toHaveBeenCalled();
  });
});
