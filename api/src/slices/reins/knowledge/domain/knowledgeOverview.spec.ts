import { NotFoundException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { IKnowledgeGateway } from './knowledge.gateway';
import { SourceService } from '../../source/domain/source.service';
import { IInstanceGateway } from '../../instance/domain/instance.gateway';
import { IKnowledgeConfigGateway } from '../../config/domain/knowledgeConfig.gateway';

function makeService(exists: boolean): KnowledgeService {
  const gateway = {
    findById: jest.fn(async () => (exists ? { id: 'k1', name: 'Mazda' } : null)),
  } as unknown as IKnowledgeGateway;
  const sources = {
    countByKnowledgeIds: jest.fn(async () =>
      new Map([['k1', { total: 651, indexed: 633, failed: 17, processing: 1 }]]),
    ),
    breakdown: jest.fn(async () => ({
      byType: { file: 650, url: 1, text: 0 },
      totalSizeBytes: 214_000_000,
    })),
  } as unknown as SourceService;
  return new KnowledgeService(
    gateway,
    sources,
    {} as IInstanceGateway,
    {} as unknown as IKnowledgeConfigGateway,
  );
}

describe('KnowledgeService.getOverview', () => {
  it('answers the Overview tab from two queries, no per-type page reads', async () => {
    expect(await makeService(true).getOverview('k1')).toEqual({
      sourceCount: 651,
      indexedCount: 633,
      failedCount: 17,
      processingCount: 1,
      byType: { file: 650, url: 1, text: 0 },
      totalSizeBytes: 214_000_000,
    });
  });

  it('is a 404 for a base that does not exist', async () => {
    await expect(makeService(false).getOverview('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
