import { IndexReconcileService } from './indexReconcile.service';
import { SourceService } from '../../source/domain/source.service';
import {
  ISourceData,
  ISourceIndexOutcome,
  ISourceRetryOutcome,
  SourceRetryActionTypes,
} from '../../source/domain';
import { ILightragClient } from '../../lightrag/domain/lightrag.client';
import { IPipelineStatus } from '../../lightrag/domain/lightrag.types';

function makeSource(id: string): ISourceData {
  return {
    id,
    knowledgeId: 'knowledge-1',
    type: 'file',
    name: `${id}.md`,
    url: 's3://bucket/key',
    mimeType: 'text/markdown',
    content: null,
    sizeBytes: 1024,
    indexed: false,
    indexStatus: 'pending',
    indexState: 'queued',
    indexError: null,
    indexedAt: null,
    indexAttempts: 0,
    indexRetryAt: null,
    textState: 'none',
    textUrl: null,
    textError: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function confirmed(id: string): ISourceIndexOutcome {
  return {
    sourceId: id,
    name: `${id}.md`,
    status: 'indexed',
    indexed: true,
    error: null,
    retryAt: null,
  };
}

function moving(id: string): ISourceIndexOutcome {
  return {
    sourceId: id,
    name: `${id}.md`,
    status: 'pending',
    indexed: false,
    error: 'still in LightRAG pipeline',
    retryAt: null,
  };
}

function pipeline(busy: boolean): IPipelineStatus {
  return { busy, docs: 0, currentBatch: 0, latestMessage: '' };
}

function makeService(
  stub: Partial<SourceService>,
  lightrag: Partial<ILightragClient> = {
    // Busy by default so the existing cases exercise reconciliation only. The
    // restart path has its own tests below.
    getPipelineStatus: jest.fn(() => Promise.resolve(pipeline(true))),
    restartPipeline: jest.fn(() => Promise.resolve()),
  },
): IndexReconcileService {
  const quiet: Partial<SourceService> = {
    findDueForRetry: jest.fn(() => Promise.resolve([])),
    retryFailed: jest.fn(() => Promise.resolve([])),
  };
  return new IndexReconcileService(
    { ...quiet, ...stub } as SourceService,
    lightrag as ILightragClient,
  );
}

describe('IndexReconcileService.reconcile', () => {
  it('does nothing when no source is waiting on LightRAG', async () => {
    const confirmProcessed = jest.fn();
    const service = makeService({
      findUnconfirmed: jest.fn(() => Promise.resolve([])),
      confirmProcessed,
    });

    expect(await service.reconcile()).toBe(0);
    // The quiet case is the common one, so it must not cost a LightRAG call.
    expect(confirmProcessed).not.toHaveBeenCalled();
  });

  it('reports how many sources LightRAG finished since the last pass', async () => {
    const service = makeService({
      findUnconfirmed: jest.fn(() =>
        Promise.resolve([makeSource('src-1'), makeSource('src-2')]),
      ),
      confirmProcessed: jest.fn(() =>
        Promise.resolve([confirmed('src-1'), moving('src-2')]),
      ),
    });

    expect(await service.reconcile()).toBe(1);
  });

  it('does not start a second pass while one is still running', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const findUnconfirmed = jest.fn(() =>
      gate.then(() => [makeSource('src-1')]),
    );
    const service = makeService({
      findUnconfirmed,
      confirmProcessed: jest.fn(() => Promise.resolve([confirmed('src-1')])),
    });

    const first = service.reconcile();
    // Fires while the first pass is still awaiting: on a large base a pass
    // outlives the interval, and two passes would duplicate every status read.
    const second = await service.reconcile();
    release?.();

    expect(second).toBe(0);
    expect(await first).toBe(1);
    expect(findUnconfirmed).toHaveBeenCalledTimes(1);
  });

  it('releases the lock when a pass throws, so it recovers next tick', async () => {
    const findUnconfirmed = jest
      .fn()
      .mockRejectedValueOnce(new Error('lightrag unreachable'))
      .mockResolvedValueOnce([]);
    const service = makeService({ findUnconfirmed });

    await expect(service.reconcile()).rejects.toThrow('lightrag unreachable');
    expect(await service.reconcile()).toBe(0);
    expect(findUnconfirmed).toHaveBeenCalledTimes(2);
  });
});

describe('IndexReconcileService: recovering a stalled pipeline', () => {
  function waiting(stub: Partial<ILightragClient>): IndexReconcileService {
    return makeService(
      {
        findUnconfirmed: jest.fn(() => Promise.resolve([makeSource('src-1')])),
        confirmProcessed: jest.fn(() => Promise.resolve([moving('src-1')])),
      },
      stub,
    );
  }

  it('re-queues the backlog when documents wait on a pipeline that is idle', async () => {
    // The 2026-09-01 outage exactly: LightRAG's in-process queue died with a
    // replaced pod, its database still said PENDING, and nothing on either side
    // was going to notice.
    const restartPipeline = jest.fn(() => Promise.resolve());
    const service = waiting({
      getPipelineStatus: jest.fn(() => Promise.resolve(pipeline(false))),
      restartPipeline,
    });

    await service.reconcile();

    expect(restartPipeline).toHaveBeenCalledTimes(1);
  });

  it('leaves a working pipeline alone', async () => {
    const restartPipeline = jest.fn(() => Promise.resolve());
    const service = waiting({
      getPipelineStatus: jest.fn(() => Promise.resolve(pipeline(true))),
      restartPipeline,
    });

    await service.reconcile();

    expect(restartPipeline).not.toHaveBeenCalled();
  });

  it('does not even ask when nothing is waiting', async () => {
    const getPipelineStatus = jest.fn(() => Promise.resolve(pipeline(false)));
    const service = makeService(
      {
        findUnconfirmed: jest.fn(() => Promise.resolve([makeSource('src-1')])),
        confirmProcessed: jest.fn(() => Promise.resolve([confirmed('src-1')])),
      },
      { getPipelineStatus, restartPipeline: jest.fn() },
    );

    await service.reconcile();

    expect(getPipelineStatus).not.toHaveBeenCalled();
  });

  it('nudges once and then holds off, so a stuck backlog cannot become a loop', async () => {
    const restartPipeline = jest.fn(() => Promise.resolve());
    const service = waiting({
      getPipelineStatus: jest.fn(() => Promise.resolve(pipeline(false))),
      restartPipeline,
    });

    await service.reconcile();
    await service.reconcile();
    await service.reconcile();

    expect(restartPipeline).toHaveBeenCalledTimes(1);
  });

  it('still reports its confirmations when the restart call fails', async () => {
    const service = makeService(
      {
        findUnconfirmed: jest.fn(() =>
          Promise.resolve([makeSource('src-1'), makeSource('src-2')]),
        ),
        confirmProcessed: jest.fn(() =>
          Promise.resolve([confirmed('src-1'), moving('src-2')]),
        ),
      },
      {
        getPipelineStatus: jest.fn(() => Promise.resolve(pipeline(false))),
        restartPipeline: jest.fn(() => Promise.reject(new Error('502'))),
      },
    );

    // Recovery rides along with a reconcile pass; it must never cost one.
    expect(await service.reconcile()).toBe(1);
  });
});

describe('IndexReconcileService: retrying what failed for a passing reason', () => {
  function due(id: string): ISourceData {
    return {
      ...makeSource(id),
      indexState: 'failed',
      indexStatus: 'retrying',
      indexError: 'RetryError[<Future raised BedrockConnectionError>]',
      indexAttempts: 1,
      indexRetryAt: new Date(0),
    };
  }

  function retried(
    id: string,
    action: SourceRetryActionTypes,
  ): ISourceRetryOutcome {
    return { sourceId: id, name: `${id}.md`, action, error: null };
  }

  it('puts due rows back on an idle pipeline and nudges it', async () => {
    const retryFailed = jest.fn(() => Promise.resolve([retried('src-1', 'reprocess')]));
    const restartPipeline = jest.fn(() => Promise.resolve());
    const service = makeService(
      {
        findUnconfirmed: jest.fn(() => Promise.resolve([])),
        findDueForRetry: jest.fn(() => Promise.resolve([due('src-1')])),
        retryFailed,
      },
      {
        getPipelineStatus: jest.fn(() => Promise.resolve(pipeline(false))),
        restartPipeline,
      },
    );

    await service.reconcile();

    expect(retryFailed).toHaveBeenCalledWith([due('src-1')]);
    expect(restartPipeline).toHaveBeenCalledWith('knowledge-1');
  });

  it('leaves a busy pipeline to finish; the rows stay due', async () => {
    const retryFailed = jest.fn(() => Promise.resolve([]));
    const restartPipeline = jest.fn(() => Promise.resolve());
    const service = makeService(
      {
        findUnconfirmed: jest.fn(() => Promise.resolve([])),
        findDueForRetry: jest.fn(() => Promise.resolve([due('src-1')])),
        retryFailed,
      },
      {
        getPipelineStatus: jest.fn(() => Promise.resolve(pipeline(true))),
        restartPipeline,
      },
    );

    await service.reconcile();

    expect(retryFailed).not.toHaveBeenCalled();
    expect(restartPipeline).not.toHaveBeenCalled();
  });

  it('does not nudge when nothing was left for the pipeline to reprocess', async () => {
    const restartPipeline = jest.fn(() => Promise.resolve());
    const service = makeService(
      {
        findUnconfirmed: jest.fn(() => Promise.resolve([])),
        findDueForRetry: jest.fn(() => Promise.resolve([due('src-1')])),
        retryFailed: jest.fn(() => Promise.resolve([retried('src-1', 'resent')])),
      },
      {
        getPipelineStatus: jest.fn(() => Promise.resolve(pipeline(false))),
        restartPipeline,
      },
    );

    await service.reconcile();

    expect(restartPipeline).not.toHaveBeenCalled();
  });

  it('shares the cooldown with the stall nudge on the same base', async () => {
    const retryFailed = jest.fn(() => Promise.resolve([retried('src-2', 'reprocess')]));
    const restartPipeline = jest.fn(() => Promise.resolve());
    const findDueForRetry = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([due('src-2')]);
    const service = makeService(
      {
        findUnconfirmed: jest.fn(() => Promise.resolve([makeSource('src-1')])),
        confirmProcessed: jest.fn(() => Promise.resolve([moving('src-1')])),
        findDueForRetry,
        retryFailed,
      },
      {
        getPipelineStatus: jest.fn(() => Promise.resolve(pipeline(false))),
        restartPipeline,
      },
    );

    // First pass: the stall nudge fires. Second pass, a minute later: a retry
    // comes due on the same base and has to wait the cooldown out.
    await service.reconcile();
    await service.reconcile();

    expect(restartPipeline).toHaveBeenCalledTimes(1);
    expect(retryFailed).not.toHaveBeenCalled();
  });

  it('keeps its confirmations when the retry step throws', async () => {
    const service = makeService(
      {
        findUnconfirmed: jest.fn(() => Promise.resolve([makeSource('src-1')])),
        confirmProcessed: jest.fn(() => Promise.resolve([confirmed('src-1')])),
        findDueForRetry: jest.fn(() => Promise.resolve([due('src-2')])),
        retryFailed: jest.fn(() => Promise.reject(new Error('502'))),
      },
      {
        getPipelineStatus: jest.fn(() => Promise.resolve(pipeline(false))),
        restartPipeline: jest.fn(() => Promise.resolve()),
      },
    );

    expect(await service.reconcile()).toBe(1);
  });
});
