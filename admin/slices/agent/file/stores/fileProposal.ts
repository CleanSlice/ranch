import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  AgentFileService,
  IFileChangeProposal,
  ProposalStatus,
  ProposalVia,
} from '#agentFile/domain';

export type { IFileChangeProposal } from '#agentFile/domain';

const getService = createServiceGetter<AgentFileService>('$agentFileService');

/** What a `proposal_update` socket event carries. */
export interface IProposalUpdate {
  proposalId: string;
  status: ProposalStatus;
  actedBy: string | null;
  actedVia: ProposalVia | null;
  actedAt: number;
  result?: unknown;
  restartRequired?: boolean;
  reason?: string | null;
}

/**
 * Change proposals live once here (docs/state.md), keyed by id; the bridle
 * conversation and the Files tab both render by id. `proposal` events and
 * transcript pages upsert, `proposal_update` patches, console actions patch
 * optimistically and roll back on error.
 */
export const useFileProposalStore = defineStore('fileProposal', () => {
  const byId = ref<Record<string, IFileChangeProposal>>({});
  const busy = ref<Record<string, true>>({});

  function get(id: string): IFileChangeProposal | null {
    return byId.value[id] ?? null;
  }

  function upsert(proposal: IFileChangeProposal): void {
    const existing = byId.value[proposal.id];
    // Never let a stale replay downgrade a final state to pending.
    if (existing && existing.status !== 'pending' && proposal.status === 'pending') return;
    byId.value = { ...byId.value, [proposal.id]: proposal };
  }

  function upsertMany(proposals: IFileChangeProposal[]): void {
    for (const p of proposals) upsert(p);
  }

  function patch(update: IProposalUpdate): void {
    const existing = byId.value[update.proposalId];
    if (!existing) return;
    byId.value = {
      ...byId.value,
      [update.proposalId]: {
        ...existing,
        status: update.status,
        actedBy: update.actedBy,
        actedVia: update.actedVia,
        actedAt: new Date(update.actedAt).toISOString(),
        result: (update.result as IFileChangeProposal['result']) ?? existing.result,
        restartRequired: update.restartRequired ?? existing.restartRequired,
        reason: update.reason ?? existing.reason ?? null,
      },
    };
  }

  function isBusy(id: string): boolean {
    return busy.value[id] === true;
  }

  function setBusy(id: string, on: boolean): void {
    const next = { ...busy.value };
    if (on) next[id] = true;
    else delete next[id];
    busy.value = next;
  }

  async function fetch(agentId: string, id: string): Promise<IFileChangeProposal> {
    const row = await getService().getProposal(agentId, id);
    upsert(row);
    return row;
  }

  async function fetchForChat(
    agentId: string,
    chatAgentId: string,
    channel: string,
  ): Promise<IFileChangeProposal[]> {
    const rows = await getService().listProposals(agentId, chatAgentId, channel);
    upsertMany(rows);
    return rows;
  }

  /** Apply from the card or the editor; optimistic, rolled back on error. */
  async function apply(
    agentId: string,
    id: string,
    via: ProposalVia,
    options: { content?: string; confirmRemove?: boolean } = {},
  ): Promise<IFileChangeProposal> {
    const before = byId.value[id];
    if (before) upsert({ ...before, status: 'applied', actedVia: via });
    setBusy(id, true);
    try {
      const outcome = await getService().applyProposal(agentId, id, via, options);
      if (outcome.status === 'conflict') {
        if (before) byId.value = { ...byId.value, [id]: before };
        throw new ProposalRemoveConfirmNeeded(outcome.remove);
      }
      byId.value = { ...byId.value, [id]: outcome.proposal };
      return outcome.proposal;
    } catch (err) {
      if (before && !(err instanceof ProposalRemoveConfirmNeeded)) {
        byId.value = { ...byId.value, [id]: before };
      }
      throw err;
    } finally {
      setBusy(id, false);
    }
  }

  async function skip(agentId: string, id: string): Promise<IFileChangeProposal> {
    const before = byId.value[id];
    if (before) upsert({ ...before, status: 'skipped', actedVia: 'card' });
    setBusy(id, true);
    try {
      const row = await getService().skipProposal(agentId, id);
      byId.value = { ...byId.value, [id]: row };
      return row;
    } catch (err) {
      if (before) byId.value = { ...byId.value, [id]: before };
      throw err;
    } finally {
      setBusy(id, false);
    }
  }

  function content(agentId: string, id: string): Promise<string> {
    return getService().proposalContent(agentId, id);
  }

  function diff(agentId: string, id: string, path?: string): Promise<string> {
    return getService().proposalDiff(agentId, id, path);
  }

  return {
    byId,
    get,
    upsert,
    upsertMany,
    patch,
    isBusy,
    fetch,
    fetchForChat,
    apply,
    skip,
    content,
    diff,
  };
});

/** Thrown by `apply` when a replace import needs the removal acknowledgement. */
export class ProposalRemoveConfirmNeeded extends Error {
  constructor(public readonly remove: number) {
    super(`Replace would remove ${remove} files`);
    this.name = 'ProposalRemoveConfirmNeeded';
  }
}
