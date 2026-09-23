import { Injectable } from '@nestjs/common';
import type { FileChangeProposal, Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  ICreateProposal,
  IFileChangeProposal,
  IFileProposalRepository,
  IProposalSetSummary,
  ITransitionPatch,
  ProposalStatus,
} from '../domain/fileProposal.types';
import type { IImportResult, ImportMode } from '../domain/import.types';

/** Prisma access for FileChangeProposal (CLEAN-112). */
@Injectable()
export class FileProposalRepository extends IFileProposalRepository {
  constructor(private prisma: PrismaService) {
    super();
  }

  async create(input: ICreateProposal): Promise<IFileChangeProposal> {
    const row = await this.prisma.fileChangeProposal.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        agentId: input.agentId,
        chatAgentId: input.chatAgentId,
        channel: input.channel,
        clientId: input.clientId,
        turnId: input.turnId,
        kind: input.kind,
        op: input.op,
        path: input.path,
        baseEtag: input.baseEtag,
        contentKey: input.contentKey,
        importId: input.importId,
        mode: input.mode,
        includeSessions: input.includeSessions,
        proposedBytes: input.proposedBytes,
        diffStatus: input.diffStatus,
        additions: input.additions,
        deletions: input.deletions,
        changedLines: input.changedLines,
        firstChangedLine: input.firstChangedLine,
        inlineDiff: input.inlineDiff,
        summary: toJson(input.summary),
      },
    });
    return toDomain(row);
  }

  async findById(id: string): Promise<IFileChangeProposal | null> {
    const row = await this.prisma.fileChangeProposal.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async listForChat(
    chatAgentId: string,
    channel: string,
    opts: { since?: Date; until?: Date; includePending?: boolean },
  ): Promise<IFileChangeProposal[]> {
    const windowed: Prisma.FileChangeProposalWhereInput = {
      chatAgentId,
      channel,
      ...(opts.since || opts.until
        ? {
            createdAt: {
              ...(opts.since ? { gte: opts.since } : {}),
              ...(opts.until ? { lte: opts.until } : {}),
            },
          }
        : {}),
    };
    const where: Prisma.FileChangeProposalWhereInput = opts.includePending
      ? { OR: [windowed, { chatAgentId, channel, status: 'pending' }] }
      : windowed;
    const rows = await this.prisma.fileChangeProposal.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomain);
  }

  async transition(
    id: string,
    from: ProposalStatus,
    to: ProposalStatus,
    patch: ITransitionPatch,
  ): Promise<{ won: boolean; row: IFileChangeProposal | null }> {
    const res = await this.prisma.fileChangeProposal.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        actedBy: patch.actedBy ?? undefined,
        actedVia: patch.actedVia ?? undefined,
        actedAt: patch.actedAt ?? new Date(),
        result: toJson(patch.result),
        reason: patch.reason ?? undefined,
      },
    });
    const row = await this.findById(id);
    return { won: res.count === 1, row };
  }

  async markSiblingsStale(
    agentId: string,
    path: string,
    exceptId: string,
  ): Promise<IFileChangeProposal[]> {
    const siblings = await this.prisma.fileChangeProposal.findMany({
      where: { agentId, path, kind: 'single', status: 'pending', NOT: { id: exceptId } },
    });
    if (!siblings.length) return [];
    await this.prisma.fileChangeProposal.updateMany({
      where: { id: { in: siblings.map((s) => s.id) } },
      data: {
        status: 'stale',
        actedAt: new Date(),
        reason: 'Another proposal for this file was applied first',
      },
    });
    const rows = await this.prisma.fileChangeProposal.findMany({
      where: { id: { in: siblings.map((s) => s.id) } },
    });
    return rows.map(toDomain);
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return value as Prisma.InputJsonValue;
}

function toDomain(row: FileChangeProposal): IFileChangeProposal {
  return {
    id: row.id,
    agentId: row.agentId,
    chatAgentId: row.chatAgentId,
    channel: row.channel,
    clientId: row.clientId,
    turnId: row.turnId,
    kind: row.kind as IFileChangeProposal['kind'],
    op: row.op as IFileChangeProposal['op'],
    path: row.path,
    baseEtag: row.baseEtag,
    contentKey: row.contentKey,
    importId: row.importId,
    mode: (row.mode as ImportMode | null) ?? null,
    includeSessions: row.includeSessions,
    proposedBytes: row.proposedBytes,
    diffStatus: row.diffStatus as IFileChangeProposal['diffStatus'],
    additions: row.additions,
    deletions: row.deletions,
    changedLines: row.changedLines,
    firstChangedLine: row.firstChangedLine,
    inlineDiff: row.inlineDiff,
    summary: (row.summary as unknown as IProposalSetSummary | null) ?? null,
    status: row.status as ProposalStatus,
    actedBy: row.actedBy,
    actedVia: (row.actedVia as IFileChangeProposal['actedVia']) ?? null,
    actedAt: row.actedAt,
    result: (row.result as unknown as IImportResult | { etag: string } | null) ?? null,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}
