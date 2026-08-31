import { SyncGuardService, PULL_MARGIN_MS } from './syncGuard.service';
import { IFileGateway } from './file.gateway';
import { IFileNode } from './file.types';

const T0 = new Date('2026-08-31T10:00:00Z').getTime();
const at = (offsetSec: number) => new Date(T0 + offsetSec * 1000);

function fileStub(nodes: IFileNode[]): IFileGateway {
  return {
    list: async (): Promise<IFileNode[]> => nodes,
  } as unknown as IFileGateway;
}

const node = (path: string, updatedAt: Date): IFileNode => ({
  path,
  size: 1,
  updatedAt,
});

describe('SyncGuardService', () => {
  describe('computeBaseline', () => {
    const guard = new SyncGuardService(fileStub([]));

    it('returns null when both markers are null (legacy agent — skip check)', () => {
      expect(guard.computeBaseline(null, null)).toBeNull();
    });

    it('uses lastPullAt minus margin when only the pull marker exists', () => {
      expect(guard.computeBaseline(at(0), null)).toEqual(
        new Date(T0 - PULL_MARGIN_MS),
      );
    });

    it('uses lastSyncAt as-is when only the sync marker exists', () => {
      expect(guard.computeBaseline(null, at(0))).toEqual(at(0));
    });

    it('takes the max of (pull - margin) and sync', () => {
      // Sync 10s after pull: sync wins over pull-with-margin.
      expect(guard.computeBaseline(at(0), at(10))).toEqual(at(10));
      // Sync long before the latest boot: pull-with-margin wins.
      expect(guard.computeBaseline(at(3600), at(0))).toEqual(
        new Date(at(3600).getTime() - PULL_MARGIN_MS),
      );
    });
  });

  describe('assess', () => {
    it('returns empty atRisk without listing files when no baseline', async () => {
      const list = jest.fn();
      const guard = new SyncGuardService({
        list,
      } as unknown as IFileGateway);
      const result = await guard.assess('agent-1', null, null);
      expect(result).toEqual({ baseline: null, atRisk: [] });
      expect(list).not.toHaveBeenCalled();
    });

    it('flags only files whose S3 copy is newer than the baseline', async () => {
      const guard = new SyncGuardService(
        fileStub([
          node('SOUL.md', at(500)), // edited after sync → at risk
          node('notes.md', at(-500)), // untouched since boot → safe
          node('config.json', at(100)), // exactly at baseline → safe (strict >)
        ]),
      );
      const result = await guard.assess('agent-1', at(-1000), at(100));
      expect(result.baseline).toEqual(at(100));
      expect(result.atRisk.map((n) => n.path)).toEqual(['SOUL.md']);
    });

    it('applies the pull margin: file edited just before connect is at risk', async () => {
      // Pull recorded at T0; S3 write landed 30s earlier (inside the
      // pull→connect window). Margin must catch it.
      const guard = new SyncGuardService(fileStub([node('SOUL.md', at(-30))]));
      const result = await guard.assess('agent-1', at(0), null);
      expect(result.atRisk.map((n) => n.path)).toEqual(['SOUL.md']);
    });

    it('passes through with no at-risk files (frictionless sync)', async () => {
      const guard = new SyncGuardService(
        fileStub([node('a.md', at(-120)), node('b.md', at(-90))]),
      );
      const result = await guard.assess('agent-1', at(0), null);
      expect(result.atRisk).toEqual([]);
    });
  });
});
