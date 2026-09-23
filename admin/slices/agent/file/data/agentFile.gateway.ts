import { FilesService } from '#api/data';
import { authedFetch } from '#auth/utils/authedFetch';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IAgentFileGateway } from '../domain/agentFile.gateway';
import {
  SaveRefusedError,
  type IAtRiskFile,
  type IDeleteOutcome,
  type IFileChunk,
  type IFileContent,
  type IFileLimits,
  type IFileNode,
  type IOpenLink,
  type ISaveOptions,
  type ISyncOutcome,
} from '../domain/agentFile.types';
import { AgentFileMapper } from './agentFile.mapper';

type SdkFailure = {
  error?: { message?: string | string[] } | undefined;
  response?: { status?: number };
};

function errorMessage(res: unknown, fallback: string): string {
  const err = (res as SdkFailure).error;
  const m = err?.message;
  if (Array.isArray(m)) return m.join('; ');
  return typeof m === 'string' && m ? m : fallback;
}

function statusOf(res: unknown): number | undefined {
  const r = res as SdkFailure;
  return r.error !== undefined ? r.response?.status : undefined;
}

export class AgentFileGateway extends BaseGateway implements IAgentFileGateway {
  private mapper = new AgentFileMapper();

  list(agentId: string): Promise<IFileNode[]> {
    return this.execute(async () => {
      const res = await FilesService.fileControllerList({ path: { agentId } });
      return this.mapper.toNodeList(unwrapEnvelope(res.data));
    });
  }

  limits(agentId: string): Promise<IFileLimits> {
    return this.execute(async () => {
      const res = await FilesService.fileControllerLimits({ path: { agentId } });
      return this.mapper.toLimits(unwrapEnvelope(res.data));
    });
  }

  read(
    agentId: string,
    path: string,
    offset: number,
    limit: number,
  ): Promise<IFileChunk> {
    return this.execute(async () => {
      const res = await FilesService.fileControllerRead({
        path: { agentId },
        query: { path, offset, limit },
      });
      const chunk = this.mapper.toChunk(unwrapEnvelope(res.data));
      if (!chunk) throw new Error(errorMessage(res, 'Failed to load file'));
      return chunk;
    });
  }

  save(
    agentId: string,
    path: string,
    content: string,
    options: ISaveOptions = {},
  ): Promise<IFileContent> {
    return this.execute(async () => {
      const res = await FilesService.fileControllerSave({
        path: { agentId },
        query: { path },
        body: {
          content,
          createOnly: options.createOnly,
          ifUnmodifiedSince: options.ifUnmodifiedSince,
        },
      });
      const status = statusOf(res);
      if (status === 409) {
        throw new SaveRefusedError('exists', errorMessage(res, `${path} already exists`));
      }
      if (status === 412) {
        throw new SaveRefusedError(
          'conflict',
          errorMessage(res, `${path} changed since you opened it`),
        );
      }
      if (status === 400) {
        throw new SaveRefusedError('invalid', errorMessage(res, 'Save refused'));
      }
      const updated = this.mapper.toContent(unwrapEnvelope(res.data));
      if (!updated) throw new Error(errorMessage(res, 'Failed to save file'));
      return updated;
    });
  }

  remove(agentId: string, path: string, recursive: boolean): Promise<number> {
    return this.execute(async () => {
      const res = await FilesService.fileControllerDelete({
        path: { agentId },
        query: { path, recursive },
      });
      const payload = unwrapEnvelope<{ deleted?: number }>(res.data);
      return typeof payload?.deleted === 'number' ? payload.deleted : 0;
    });
  }

  removeMany(agentId: string, paths: string[], confirm = false): Promise<IDeleteOutcome> {
    return this.execute(async () => {
      const res = await FilesService.deleteAgentFileSelection({
        path: { agentId },
        body: { paths, confirm },
      });
      if (statusOf(res) === 409) {
        const c = (res as SdkFailure).error as { wouldRemove?: number; total?: number };
        return {
          status: 'conflict' as const,
          conflict: { wouldRemove: c?.wouldRemove ?? 0, total: c?.total ?? 0 },
        };
      }
      if ((res as SdkFailure).error !== undefined) {
        throw new Error(errorMessage(res, 'Delete failed'));
      }
      const payload = unwrapEnvelope<{ deleted?: number }>(res.data);
      return {
        status: 'done' as const,
        deleted: typeof payload?.deleted === 'number' ? payload.deleted : 0,
      };
    });
  }

  sync(agentId: string, confirm = false): Promise<ISyncOutcome> {
    return this.execute(async () => {
      const res = await FilesService.fileControllerSync({
        path: { agentId },
        body: { confirm },
      });
      // 409 = guard refused: S3 holds edits newer than the pod's last
      // pull/push and confirm was not set. Not an error for the domain —
      // it's the "ask the operator" branch of the sync flow.
      // The generated client is the heyapi AXIOS variant: its result union is
      // (AxiosResponse & {error: undefined}) | (AxiosError & {error: <409 body>}),
      // so `.response` only exists after narrowing to the error member.
      if (res.error !== undefined && res.response?.status === 409) {
        const conflict = res.error as {
          atRisk?: IAtRiskFile[];
          baseline?: string;
        };
        return {
          status: 'conflict' as const,
          conflict: {
            atRisk: conflict.atRisk ?? [],
            baseline: conflict.baseline ?? '',
          },
        };
      }
      return {
        status: 'done' as const,
        result: this.mapper.toSyncResult(unwrapEnvelope(res.data)),
      };
    });
  }

  openLink(agentId: string, path: string): Promise<IOpenLink> {
    return this.execute(async () => {
      const res = await FilesService.mintAgentFileOpenLink({
        path: { agentId },
        body: { path },
      });
      const link = unwrapEnvelope<{ url?: string; expiresAt?: string }>(res.data);
      if (!link?.url) throw new Error(errorMessage(res, 'Could not create the link'));
      return { url: link.url, expiresAt: link.expiresAt ?? '' };
    });
  }

  // Raw fetch: the endpoint returns raw ZIP bytes (not the JSON envelope).
  // `authedFetch` attaches the bearer and applies the same refresh-and-retry
  // rule the SDK's axios interceptor does. A selection goes through the POST
  // variant with a JSON body (CLEAN-112).
  exportZip(agentId: string, paths?: string[]): Promise<Blob> {
    return this.execute(async () => {
      const runtime = useRuntimeConfig();
      const base = `${runtime.public.apiUrl}/agents/${agentId}/files/export`;
      const res =
        paths && paths.length > 0
          ? await authedFetch(base, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ paths }),
            })
          : await authedFetch(base, { credentials: 'include' });
      if (!res.ok) {
        throw new Error(`Download failed: ${res.status} ${res.statusText}`);
      }
      return res.blob();
    });
  }
}
