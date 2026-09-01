import { FilesService } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IAgentFileGateway } from '../domain/agentFile.gateway';
import type {
  IAtRiskFile,
  IFileChunk,
  IFileContent,
  IFileNode,
  ISyncOutcome,
} from '../domain/agentFile.types';
import { AgentFileMapper } from './agentFile.mapper';

function readAccessToken(): string | null {
  if (typeof document === 'undefined') return null;
  const token = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/)?.[1];
  return token ? decodeURIComponent(token) : null;
}

export class AgentFileGateway extends BaseGateway implements IAgentFileGateway {
  private mapper = new AgentFileMapper();

  list(agentId: string): Promise<IFileNode[]> {
    return this.execute(async () => {
      const res = await FilesService.fileControllerList({ path: { agentId } });
      return this.mapper.toNodeList(unwrapEnvelope(res.data));
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
      if (!chunk) {
        const err = (res as { error?: { message?: string } }).error;
        throw new Error(err?.message ?? 'Failed to load file');
      }
      return chunk;
    });
  }

  save(agentId: string, path: string, content: string): Promise<IFileContent> {
    return this.execute(async () => {
      const res = await FilesService.fileControllerSave({
        path: { agentId },
        query: { path },
        body: { content },
      });
      const updated = this.mapper.toContent(unwrapEnvelope(res.data));
      if (!updated) {
        const err = (res as { error?: { message?: string } }).error;
        throw new Error(err?.message ?? 'Failed to save file');
      }
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

  // Raw fetch: the endpoint returns raw ZIP bytes (not the JSON envelope).
  // Replicate the Bearer-token attachment the SDK's axios interceptor does.
  exportZip(agentId: string): Promise<Blob> {
    return this.execute(async () => {
      const runtime = useRuntimeConfig();
      const headers: Record<string, string> = {};
      const token = readAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(
        `${runtime.public.apiUrl}/agents/${agentId}/files/export`,
        { credentials: 'include', headers },
      );
      if (!res.ok) {
        throw new Error(`Download failed: ${res.status} ${res.statusText}`);
      }
      return res.blob();
    });
  }
}
