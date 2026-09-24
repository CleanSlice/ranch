import { FilesService } from '#api/data';
import { authedFetch, authedXhrHeaders, ensureFreshToken } from '#auth/utils/authedFetch';
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
  type IFileChangeProposal,
  type IFileNode,
  type IImportApplyOptions,
  type IImportApplyOutcome,
  type IImportPlan,
  type IOpenLink,
  type IProposalApplyOutcome,
  type ISaveOptions,
  type ISyncOutcome,
  type ImportMode,
  type ProposalVia,
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

  // Multipart upload through XHR so the dialog can show progress; the SDK's
  // axios client has no progress hook here. Same bearer rules as attachments
  // (ensureFreshToken + authedXhrHeaders).
  stageImport(
    agentId: string,
    archive: File,
    onProgress?: (percent: number) => void,
  ): Promise<IImportPlan> {
    return this.execute(async () => {
      const runtime = useRuntimeConfig();
      const url = `${String(runtime.public.apiUrl).replace(/\/$/, '')}/agents/${encodeURIComponent(agentId)}/files/import/stage`;
      await ensureFreshToken();
      const headers = authedXhrHeaders();
      const body = await new Promise<unknown>((resolve, reject) => {
        const form = new FormData();
        form.append('archive', archive);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0 && onProgress) {
            onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
          }
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.onload = () => {
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(xhr.responseText);
          } catch {
            parsed = null;
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            const msg = (parsed as { message?: string | string[] } | null)?.message;
            const text = Array.isArray(msg) ? msg.join('; ') : msg;
            reject(
              new Error(
                text ||
                  (xhr.status === 413
                    ? 'Archive is over the size limit'
                    : `Upload failed (${xhr.status})`),
              ),
            );
            return;
          }
          resolve(parsed);
        };
        xhr.send(form);
      });
      const plan = this.mapper.toImportPlan(unwrapEnvelope(body));
      if (!plan) throw new Error('Import preview returned an unreadable response');
      return plan;
    });
  }

  planImport(
    agentId: string,
    importId: string,
    mode: ImportMode,
    includeSessions: boolean,
  ): Promise<IImportPlan> {
    return this.execute(async () => {
      const res = await FilesService.planAgentImport({
        path: { agentId, importId },
        query: { mode, includeSessions },
      });
      const plan = this.mapper.toImportPlan(unwrapEnvelope(res.data));
      if (!plan) throw new Error(errorMessage(res, 'Import preview failed'));
      return plan;
    });
  }

  applyImport(
    agentId: string,
    importId: string,
    options: IImportApplyOptions,
  ): Promise<IImportApplyOutcome> {
    return this.execute(async () => {
      const res = await FilesService.applyAgentImport({
        path: { agentId, importId },
        body: {
          mode: options.mode,
          includeSessions: options.includeSessions,
          confirmRemove: options.confirmRemove,
        },
      });
      if (statusOf(res) === 409) {
        const c = (res as SdkFailure).error as { remove?: number; requiresConfirmation?: boolean };
        if (c?.requiresConfirmation) {
          return { status: 'conflict' as const, remove: c.remove ?? 0 };
        }
        throw new Error(errorMessage(res, 'An import is already running for this agent'));
      }
      if ((res as SdkFailure).error !== undefined) {
        throw new Error(errorMessage(res, 'Import failed'));
      }
      const result = this.mapper.toImportResult(unwrapEnvelope(res.data));
      if (!result) throw new Error('Import returned an unreadable response');
      return { status: 'done' as const, result };
    });
  }

  // ── Change proposals (CLEAN-112) ──────────────────────────────

  listProposals(agentId: string, chatAgentId: string, channel: string): Promise<IFileChangeProposal[]> {
    return this.execute(async () => {
      const res = await FilesService.listAgentFileProposals({
        path: { agentId },
        query: { chatAgentId, channel },
      });
      return this.mapper.toProposalList(unwrapEnvelope(res.data));
    });
  }

  getProposal(agentId: string, proposalId: string): Promise<IFileChangeProposal> {
    return this.execute(async () => {
      const res = await FilesService.getAgentFileProposal({ path: { agentId, proposalId } });
      const row = this.mapper.toProposal(unwrapEnvelope(res.data));
      if (!row) throw new Error(errorMessage(res, 'Proposal not found'));
      return row;
    });
  }

  // Raw text routes (no envelope): plain fetch with the session bearer.
  proposalContent(agentId: string, proposalId: string): Promise<string> {
    return this.execute(async () => {
      const runtime = useRuntimeConfig();
      const res = await authedFetch(
        `${String(runtime.public.apiUrl).replace(/\/$/, '')}/agents/${encodeURIComponent(agentId)}/files/proposals/${encodeURIComponent(proposalId)}/content`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(`Could not load the proposed content (${res.status})`);
      return res.text();
    });
  }

  proposalDiff(agentId: string, proposalId: string, path?: string): Promise<string> {
    return this.execute(async () => {
      const runtime = useRuntimeConfig();
      const q = path ? `?path=${encodeURIComponent(path)}` : '';
      const res = await authedFetch(
        `${String(runtime.public.apiUrl).replace(/\/$/, '')}/agents/${encodeURIComponent(agentId)}/files/proposals/${encodeURIComponent(proposalId)}/diff${q}`,
        { credentials: 'include' },
      );
      if (res.status === 413) {
        throw new Error((await res.text()) || 'Too large to compare — download both versions');
      }
      if (!res.ok) throw new Error(`Could not compute the diff (${res.status})`);
      return res.text();
    });
  }

  applyProposal(
    agentId: string,
    proposalId: string,
    via: ProposalVia,
    options: { content?: string; confirmRemove?: boolean } = {},
  ): Promise<IProposalApplyOutcome> {
    return this.execute(async () => {
      const res = await FilesService.applyAgentFileProposal({
        path: { agentId, proposalId },
        body: {
          via: via === 'editor' ? 'editor' : 'card',
          content: options.content,
          confirmRemove: options.confirmRemove,
        },
      });
      if (statusOf(res) === 409) {
        const c = (res as SdkFailure).error as Record<string, unknown>;
        if (c?.requiresConfirmation === true) {
          return { status: 'conflict' as const, remove: typeof c.remove === 'number' ? c.remove : 0 };
        }
        // Not pending any more: the body is the current row.
        const row = this.mapper.toProposal(c);
        if (row) return { status: 'done' as const, proposal: row };
        throw new Error(errorMessage(res, 'The proposal is no longer pending'));
      }
      if ((res as SdkFailure).error !== undefined) {
        throw new Error(errorMessage(res, 'Apply failed'));
      }
      const row = this.mapper.toProposal(unwrapEnvelope(res.data));
      if (!row) throw new Error('Apply returned an unreadable response');
      return { status: 'done' as const, proposal: row };
    });
  }

  skipProposal(agentId: string, proposalId: string): Promise<IFileChangeProposal> {
    return this.execute(async () => {
      const res = await FilesService.skipAgentFileProposal({ path: { agentId, proposalId } });
      if (statusOf(res) === 409) {
        const row = this.mapper.toProposal((res as SdkFailure).error);
        if (row) return row;
      }
      if ((res as SdkFailure).error !== undefined) {
        throw new Error(errorMessage(res, 'Skip failed'));
      }
      const row = this.mapper.toProposal(unwrapEnvelope(res.data));
      if (!row) throw new Error('Skip returned an unreadable response');
      return row;
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
