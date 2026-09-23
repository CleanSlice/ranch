import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createTwoFilesPatch, structuredPatch } from 'diff';
import { IAgentGateway } from '#/agent/agent/domain';
import { IBridleGateway, PROPOSALS_CAPABILITY } from '#/bridle/domain';
import type {
  IBridleProposalEvent,
  IBridleProposalUpdateEvent,
} from '#/bridle/domain';
import { IFileGateway } from './file.gateway';
import {
  DIFF_COMPARE_MAX_BYTES,
  DIFF_INLINE_MAX_BYTES,
  DIFF_INLINE_MAX_LINES,
  MAX_EDIT_BYTES,
  PROPOSAL_LIST_ROWS,
} from './file.limits';
import { extensionOf, kindFromPath, sniffKind } from './fileKind';
import {
  DiffStatus,
  IFileChangeProposal,
  IFileProposalRepository,
  IProposalSetSummary,
  ProposalVia,
} from './fileProposal.types';
import type { IImportPlan, ImportMode } from './import.types';
import { assertJson } from './jsonCheck';
import { WorkspaceArchiveService } from './workspaceArchive.service';

/** Thrown when Apply/Skip reaches a row that already left `pending`. */
export class ProposalNotPendingError extends Error {
  constructor(public readonly row: IFileChangeProposal) {
    super(`Proposal ${row.id} is ${row.status}`);
  }
}

/** Thrown when a replace import would remove files and nobody acknowledged it. */
export class ProposalNeedsRemoveConfirmError extends Error {
  constructor(
    public readonly row: IFileChangeProposal,
    public readonly remove: number,
  ) {
    super(`Replace would remove ${remove} files`);
  }
}

export interface IProposeSingleInput {
  agentId: string;
  chatAgentId: string;
  path: string;
  content: string;
  op: 'write' | 'create';
}

export interface IProposeImportInput {
  agentId: string;
  chatAgentId: string;
  importId: string;
  plan: IImportPlan;
  mode: ImportMode;
  includeSessions: boolean;
}

export interface IApplyInput {
  actor: string;
  via: ProposalVia;
  /** Editor path: the edited text replaces the proposed one. */
  content?: string;
  /** Replace-mode imports that remove files need this explicit acknowledgement. */
  confirmRemove?: boolean;
}

/** What the card shows — the DTO shape of contracts/files.openapi.yaml. */
export interface IProposalView extends Omit<IFileChangeProposal, 'actedAt' | 'createdAt' | 'contentKey' | 'importId' | 'baseEtag' | 'clientId' | 'turnId'> {
  agentName: string;
  actedAt: string | null;
  createdAt: string;
  restartRequired: boolean;
}

/**
 * Change proposals (CLEAN-112, research R6/R7): every write an agent asks
 * for through the chat becomes a row here, its diff computed once and
 * capped, its card published into the live turn, and its apply guarded by
 * the ETag the proposal was computed against. The console's Apply and the
 * agent's confirming call meet in `apply`, so the two paths cannot drift.
 */
@Injectable()
export class FileProposalService {
  private readonly logger = new Logger(FileProposalService.name);

  constructor(
    private readonly files: IFileGateway,
    private readonly proposals: IFileProposalRepository,
    private readonly archive: WorkspaceArchiveService,
    @Inject(forwardRef(() => IBridleGateway))
    private readonly hub: IBridleGateway,
    @Inject(forwardRef(() => IAgentGateway))
    private readonly agents: IAgentGateway,
  ) {}

  // ── Propose ─────────────────────────────────────────────────────

  async propose(input: IProposeSingleInput): Promise<IFileChangeProposal> {
    const { agentId, path, content } = input;
    const bytes = Buffer.byteLength(content, 'utf-8');
    if (bytes > MAX_EDIT_BYTES) {
      throw new BadRequestException(
        `${path} is too large to write from the chat (limit ${MAX_EDIT_BYTES} bytes)`,
      );
    }
    const guess = kindFromPath(path);
    const kind = guess === 'unknown' ? sniffKind(Buffer.from(content, 'utf-8')) : guess;
    if (kind !== 'text') {
      throw new BadRequestException(`${path} is not a text file`);
    }
    if (extensionOf(path) === '.json') assertJson(content);

    const baseEtag = await this.files.headEtag(agentId, path);
    if (input.op === 'create' && baseEtag) {
      throw new ConflictException(`${path} already exists`);
    }

    // Base content for the diff — only when it is small enough to compare.
    let base: string | null = null;
    let diffStatus: DiffStatus = 'ok';
    if (bytes > DIFF_COMPARE_MAX_BYTES) {
      diffStatus = 'too_large';
    } else if (baseEtag) {
      try {
        const current = await this.files.read(agentId, path);
        if (current.kind !== 'text') diffStatus = 'binary';
        else if (current.size > DIFF_COMPARE_MAX_BYTES) diffStatus = 'too_large';
        else base = current.content;
      } catch (err) {
        // A base that cannot be read (too large for the whole-file read)
        // means no diff, not no proposal.
        this.logger.debug(`No diff base for ${agentId}/${path}: ${(err as Error).message}`);
        diffStatus = 'too_large';
      }
    } else {
      base = '';
    }

    const stats =
      diffStatus === 'ok' && base !== null
        ? computeDiff(path, base, content)
        : null;

    const id = randomUUID();
    await this.files.putProposalContent(id, content);

    const turn = this.hub.findActiveTurn(input.chatAgentId);
    const row = await this.proposals.create({
      id,
      agentId,
      chatAgentId: input.chatAgentId,
      channel: turn?.clientId ?? 'admin',
      clientId: turn?.clientId ?? null,
      turnId: turn?.turnId ?? null,
      kind: 'single',
      op: input.op,
      path,
      baseEtag,
      contentKey: `proposals/${id}/content`,
      importId: null,
      mode: null,
      includeSessions: false,
      proposedBytes: bytes,
      diffStatus,
      additions: stats?.additions ?? null,
      deletions: stats?.deletions ?? null,
      changedLines: stats?.changedLines ?? null,
      firstChangedLine: stats?.firstChangedLine ?? null,
      inlineDiff: stats?.inlineDiff ?? null,
      summary: null,
    });

    await this.publishProposal(row);
    return row;
  }

  async proposeImport(input: IProposeImportInput): Promise<IFileChangeProposal> {
    const plan = input.plan;
    const summary: IProposalSetSummary = {
      counts: plan.counts,
      rows: plan.entries
        .filter((e) => e.action !== 'unchanged')
        .slice(0, PROPOSAL_LIST_ROWS),
      more: Math.max(
        0,
        plan.entries.filter((e) => e.action !== 'unchanged').length -
          PROPOSAL_LIST_ROWS +
          plan.more,
      ),
      mode: input.mode,
      includeSessions: input.includeSessions,
      wrapperStripped: plan.wrapperStripped,
      warnings: plan.warnings,
    };

    const turn = this.hub.findActiveTurn(input.chatAgentId);
    const row = await this.proposals.create({
      id: randomUUID(),
      agentId: input.agentId,
      chatAgentId: input.chatAgentId,
      channel: turn?.clientId ?? 'admin',
      clientId: turn?.clientId ?? null,
      turnId: turn?.turnId ?? null,
      kind: 'set',
      op: 'import',
      path: null,
      baseEtag: null,
      contentKey: null,
      importId: input.importId,
      mode: input.mode,
      includeSessions: input.includeSessions,
      proposedBytes: plan.totalBytes,
      diffStatus: 'none',
      additions: null,
      deletions: null,
      changedLines: null,
      firstChangedLine: null,
      inlineDiff: null,
      summary,
    });

    await this.publishProposal(row);
    return row;
  }

  // ── Act ─────────────────────────────────────────────────────────

  async apply(id: string, input: IApplyInput): Promise<IFileChangeProposal> {
    const row = await this.proposals.findById(id);
    if (!row) throw new NotFoundException('Proposal not found');
    if (row.status !== 'pending') throw new ProposalNotPendingError(row);

    return row.kind === 'single'
      ? this.applySingle(row, input)
      : this.applySet(row, input);
  }

  private async applySingle(
    row: IFileChangeProposal,
    input: IApplyInput,
  ): Promise<IFileChangeProposal> {
    const path = row.path as string;
    const currentEtag = await this.files.headEtag(row.agentId, path);
    if ((row.baseEtag ?? null) !== (currentEtag ?? null)) {
      return this.settle(row.id, 'stale', {
        actedBy: input.actor,
        actedVia: input.via,
        reason: row.baseEtag
          ? 'The file changed since this was proposed'
          : 'The file was created since this was proposed',
      });
    }

    const content =
      input.content ?? (await this.files.getProposalContent(row.id));
    if (content === null) {
      return this.settle(row.id, 'refused', {
        actedBy: input.actor,
        actedVia: input.via,
        reason: 'The proposed content is no longer available',
      });
    }

    try {
      await this.files.save(row.agentId, path, content, {
        createOnly: row.op === 'create',
      });
    } catch (err) {
      return this.settle(row.id, 'refused', {
        actedBy: input.actor,
        actedVia: input.via,
        reason: (err as Error).message || 'Save refused',
      });
    }

    const etag = (await this.files.headEtag(row.agentId, path)) ?? '';
    const applied = await this.settle(row.id, 'applied', {
      actedBy: input.actor,
      actedVia: input.via,
      result: { etag },
    });
    await this.files.deleteProposalContent(row.id).catch(() => undefined);

    const siblings = await this.proposals.markSiblingsStale(row.agentId, path, row.id);
    for (const s of siblings) await this.publishUpdate(s);
    return applied;
  }

  private async applySet(
    row: IFileChangeProposal,
    input: IApplyInput,
  ): Promise<IFileChangeProposal> {
    const importId = row.importId as string;
    const stage = await this.files.getStage(row.agentId, importId);
    if (!stage) {
      return this.settle(row.id, 'refused', {
        actedBy: input.actor,
        actedVia: input.via,
        reason: 'The staged archive expired — ask the agent to import it again',
      });
    }
    const { entries, wrapperStripped } = await this.archive.validate(stage.zip);
    const mode = row.mode ?? 'merge';
    const plan = await this.archive.plan(
      row.agentId,
      entries,
      { mode, includeSessions: row.includeSessions },
      { importId, wrapperStripped },
    );
    if (mode === 'replace' && plan.counts.remove > 0 && !input.confirmRemove) {
      throw new ProposalNeedsRemoveConfirmError(row, plan.counts.remove);
    }

    const result = await this.archive.apply(row.agentId, entries, plan);
    result.restartRequired = await this.isRunning(row.agentId);
    await this.files.deleteStage(row.agentId, importId).catch(() => undefined);
    return this.settle(row.id, 'applied', {
      actedBy: input.actor,
      actedVia: input.via,
      result,
    });
  }

  async skip(id: string, actor: string): Promise<IFileChangeProposal> {
    const row = await this.proposals.findById(id);
    if (!row) throw new NotFoundException('Proposal not found');
    if (row.status !== 'pending') throw new ProposalNotPendingError(row);
    const skipped = await this.settle(id, 'skipped', { actedBy: actor, actedVia: 'card' });
    if (row.contentKey) {
      await this.files.deleteProposalContent(id).catch(() => undefined);
    }
    return skipped;
  }

  /** Conditional transition; a lost race hands back the winner's row. */
  private async settle(
    id: string,
    to: IFileChangeProposal['status'],
    patch: Parameters<IFileProposalRepository['transition']>[3],
  ): Promise<IFileChangeProposal> {
    const { won, row } = await this.proposals.transition(id, 'pending', to, patch);
    if (!row) throw new NotFoundException('Proposal not found');
    if (!won) throw new ProposalNotPendingError(row);
    await this.publishUpdate(row);
    return row;
  }

  // ── Read ────────────────────────────────────────────────────────

  async get(id: string): Promise<IFileChangeProposal> {
    const row = await this.proposals.findById(id);
    if (!row) throw new NotFoundException('Proposal not found');
    return row;
  }

  listForChat(
    chatAgentId: string,
    channel: string,
    opts: { since?: Date; until?: Date; includePending?: boolean },
  ): Promise<IFileChangeProposal[]> {
    return this.proposals.listForChat(chatAgentId, channel, opts);
  }

  /** Proposed content of a single proposal (Edit before applying). */
  async content(id: string): Promise<string> {
    const row = await this.get(id);
    if (row.kind !== 'single') {
      throw new BadRequestException('A set proposal has no single content');
    }
    const content = await this.files.getProposalContent(id);
    if (content === null) throw new NotFoundException('Proposed content is gone');
    return content;
  }

  /**
   * Full unified diff, computed on demand and capped: a single proposal
   * against the current file, or one entry of a set against the current
   * object. Above DIFF_COMPARE_MAX_BYTES nothing is computed.
   */
  async diffFor(id: string, path?: string): Promise<string> {
    const row = await this.get(id);
    if (row.kind === 'single') {
      const target = row.path as string;
      if (row.proposedBytes > DIFF_COMPARE_MAX_BYTES) {
        throw new PayloadTooLarge(`${target} is over the comparison limit`);
      }
      const proposed = await this.files.getProposalContent(id);
      if (proposed === null) throw new NotFoundException('Proposed content is gone');
      const base = await this.currentText(row.agentId, target);
      return createTwoFilesPatch(target, target, base, proposed, 'stored', 'proposed');
    }
    if (!path) throw new BadRequestException('path is required for a set proposal');
    const stage = await this.files.getStage(row.agentId, row.importId as string);
    if (!stage) throw new NotFoundException('The staged archive expired');
    const { entries } = await this.archive.validate(stage.zip);
    const entry = entries.find((e) => e.path === path);
    if (!entry) throw new NotFoundException(`${path} is not in the archive`);
    if (entry.size > DIFF_COMPARE_MAX_BYTES) {
      throw new PayloadTooLarge(`${path} is over the comparison limit`);
    }
    const proposed = entry.bytes.toString('utf-8');
    const base = await this.currentText(row.agentId, path);
    return createTwoFilesPatch(path, path, base, proposed, 'stored', 'archive');
  }

  private async currentText(agentId: string, path: string): Promise<string> {
    const etag = await this.files.headEtag(agentId, path);
    if (!etag) return '';
    const current = await this.files.read(agentId, path);
    if (current.kind !== 'text') {
      throw new BadRequestException(`${path} is binary — download both to compare`);
    }
    return current.content;
  }

  async toView(row: IFileChangeProposal): Promise<IProposalView> {
    const agent = await this.agents.findById(row.agentId).catch(() => null);
    return viewOf(row, agent?.name ?? row.agentId, agent?.status === 'running');
  }

  async toViews(rows: IFileChangeProposal[]): Promise<IProposalView[]> {
    const names = new Map<string, { name: string; running: boolean }>();
    const out: IProposalView[] = [];
    for (const row of rows) {
      let info = names.get(row.agentId);
      if (!info) {
        const agent = await this.agents.findById(row.agentId).catch(() => null);
        info = { name: agent?.name ?? row.agentId, running: agent?.status === 'running' };
        names.set(row.agentId, info);
      }
      out.push(viewOf(row, info.name, info.running));
    }
    return out;
  }

  // ── Publish ─────────────────────────────────────────────────────

  private async isRunning(agentId: string): Promise<boolean> {
    const agent = await this.agents.findById(agentId).catch(() => null);
    return agent?.status === 'running';
  }

  private async publishProposal(row: IFileChangeProposal): Promise<void> {
    if (!row.clientId || !row.turnId) {
      this.logger.debug(
        `No active turn for chat agent=${row.chatAgentId}; proposal ${row.id} shows on reload`,
      );
      return;
    }
    const event: IBridleProposalEvent = {
      type: 'proposal',
      clientId: row.clientId,
      turnId: row.turnId,
      ts: row.createdAt.getTime(),
      proposal: (await this.toView(row)) as unknown as Record<string, unknown>,
    };
    this.hub.sendToClient(row.clientId, row.chatAgentId, event);
  }

  private async publishUpdate(row: IFileChangeProposal): Promise<void> {
    if (row.status === 'pending') return;
    const event: IBridleProposalUpdateEvent = {
      type: 'proposal_update',
      ts: Date.now(),
      proposalId: row.id,
      agentId: row.agentId,
      status: row.status,
      actedBy: row.actedBy,
      actedVia: row.actedVia,
      actedAt: (row.actedAt ?? new Date()).getTime(),
      result: row.result ?? undefined,
      restartRequired:
        row.status === 'applied' ? await this.isRunning(row.agentId) : undefined,
      reason: row.reason,
    };
    this.hub.sendToAgentClients(row.chatAgentId, event, PROPOSALS_CAPABILITY);
  }
}

/** 413 for the diff route. */
export class PayloadTooLarge extends BadRequestException {
  constructor(message: string) {
    super(message);
  }
}

export interface IDiffStats {
  additions: number;
  deletions: number;
  changedLines: number;
  firstChangedLine: number | null;
  inlineDiff: string | null;
}

/**
 * Line diff with three lines of context. The inline text is kept only
 * within the card caps (research R7); counts are always kept.
 */
export function computeDiff(path: string, base: string, proposed: string): IDiffStats {
  const patch = structuredPatch(path, path, base, proposed, 'stored', 'proposed', {
    context: 3,
  });
  let additions = 0;
  let deletions = 0;
  let firstChangedLine: number | null = null;
  for (const hunk of patch.hunks) {
    let newLine = hunk.newStart;
    for (const line of hunk.lines) {
      const mark = line[0];
      if (mark === '+') {
        additions++;
        if (firstChangedLine === null) firstChangedLine = newLine;
        newLine++;
      } else if (mark === '-') {
        deletions++;
        if (firstChangedLine === null) firstChangedLine = newLine;
      } else {
        newLine++;
      }
    }
  }
  const changedLines = additions + deletions;
  const proposedBytes = Buffer.byteLength(proposed, 'utf-8');
  const inline =
    changedLines > 0 &&
    changedLines <= DIFF_INLINE_MAX_LINES &&
    proposedBytes <= DIFF_INLINE_MAX_BYTES
      ? createTwoFilesPatch(path, path, base, proposed, 'stored', 'proposed', { context: 3 })
      : null;
  return { additions, deletions, changedLines, firstChangedLine, inlineDiff: inline };
}

function viewOf(row: IFileChangeProposal, agentName: string, running: boolean): IProposalView {
  return {
    id: row.id,
    agentId: row.agentId,
    agentName,
    chatAgentId: row.chatAgentId,
    channel: row.channel,
    kind: row.kind,
    op: row.op,
    path: row.path,
    mode: row.mode,
    includeSessions: row.includeSessions,
    proposedBytes: row.proposedBytes,
    diffStatus: row.diffStatus,
    additions: row.additions,
    deletions: row.deletions,
    changedLines: row.changedLines,
    firstChangedLine: row.firstChangedLine,
    inlineDiff: row.inlineDiff,
    summary: row.summary,
    status: row.status,
    actedBy: row.actedBy,
    actedVia: row.actedVia,
    actedAt: row.actedAt ? row.actedAt.toISOString() : null,
    result: row.result,
    reason: row.reason,
    restartRequired: running,
    createdAt: row.createdAt.toISOString(),
  };
}
