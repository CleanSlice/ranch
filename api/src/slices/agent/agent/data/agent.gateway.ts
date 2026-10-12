import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { IAgentGateway } from '../domain/agent.gateway';
import {
  IAgentData,
  ICreateAgentData,
  IUpdateAgentData,
  AgentStatusTypes,
  LaunchContextTypes,
} from '../domain/agent.types';
import { AgentStatusChanges } from '../domain/agentStatusChanges';
import { AgentMapper } from './agent.mapper';

@Injectable()
export class AgentGateway extends IAgentGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: AgentMapper,
    private statusChanges: AgentStatusChanges,
  ) {
    super();
  }

  async findAll(): Promise<IAgentData[]> {
    const records = await this.prisma.agent.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findPublic(): Promise<IAgentData[]> {
    const records = await this.prisma.agent.findMany({
      where: { isPublic: true },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findAdmin(): Promise<IAgentData | null> {
    const record = await this.prisma.agent.findFirst({
      where: { isAdmin: true },
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  async findById(id: string): Promise<IAgentData | null> {
    const record = await this.prisma.agent.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async findByTemplateId(templateId: string): Promise<IAgentData[]> {
    const records = await this.prisma.agent.findMany({ where: { templateId } });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async create(data: ICreateAgentData): Promise<IAgentData> {
    const record = await this.prisma.agent.create({
      data: this.mapper.toCreate(data),
    });
    return this.mapper.toEntity(record);
  }

  async update(id: string, data: IUpdateAgentData): Promise<IAgentData> {
    const record = await this.prisma.agent.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.llmCredentialId !== undefined && {
          llmCredentialId: data.llmCredentialId,
        }),
        ...(data.config && {
          config: data.config as unknown as Prisma.InputJsonValue,
        }),
        ...(data.resources && {
          resources: data.resources as unknown as Prisma.InputJsonValue,
        }),
        ...(data.isPublic !== undefined && { isPublic: data.isPublic }),
        ...(data.allowedOrigins !== undefined && {
          allowedOrigins: data.allowedOrigins,
        }),
        ...(data.knowledgeIds !== undefined && {
          knowledgeIds: data.knowledgeIds,
        }),
        ...(data.debugEnabled !== undefined && {
          debugEnabled: data.debugEnabled,
        }),
      },
    });
    return this.mapper.toEntity(record);
  }

  async updateStatus(
    id: string,
    status: AgentStatusTypes,
    workflowId?: string | null,
    statusReason?: string,
  ): Promise<IAgentData> {
    // statusReason lives and dies with 'failed'/'unreachable': every
    // transition to any other status clears it, so a reason can never
    // outlive the condition it describes.
    const reason =
      status === 'failed' || status === 'unreachable'
        ? (statusReason ?? null)
        : null;
    const data = {
      status,
      statusReason: reason,
      // `undefined` leaves the column untouched; `null` clears it (used when
      // stopping an agent so the now-cancelled workflow id isn't kept around).
      ...(workflowId !== undefined && { workflowId }),
    };

    // A real transition is the row moving to a status it did not have. The
    // condition lives in the WHERE, so the database decides it: two replicas
    // writing 'failed' for the same pod event both run this, and one of them
    // matches no row. Only the one that moved the row announces the change
    // (CLEAN-139) — reading the status first and comparing would let both.
    const moved = await this.prisma.agent.updateMany({
      where: { id, NOT: { status } },
      data,
    });
    if (moved.count === 0) {
      // Same status (or no such agent, which throws here as it always did):
      // the reason and the workflow id are still written, nothing is announced.
      const record = await this.prisma.agent.update({ where: { id }, data });
      return this.mapper.toEntity(record);
    }
    this.statusChanges.emit({ agentId: id, status, reason, at: new Date() });
    const record = await this.prisma.agent.findUniqueOrThrow({ where: { id } });
    return this.mapper.toEntity(record);
  }

  async setStatusReason(id: string, reason: string): Promise<void> {
    await this.prisma.agent.update({
      where: { id },
      data: { statusReason: reason },
    });
  }

  async markDeployStarted(
    id: string,
    launchContext: LaunchContextTypes,
  ): Promise<IAgentData> {
    const record = await this.prisma.agent.update({
      where: { id },
      data: {
        status: 'deploying',
        statusReason: null,
        lastDeployStartedAt: new Date(),
        lastLaunchContext: launchContext,
      },
    });
    return this.mapper.toEntity(record);
  }

  async setFirstDeployedAt(id: string): Promise<void> {
    // Conditional updateMany keeps set-once semantics without a read-modify-
    // write race: only the very first deploy finds firstDeployedAt IS NULL.
    await this.prisma.agent.updateMany({
      where: { id, firstDeployedAt: null },
      data: { firstDeployedAt: new Date() },
    });
  }

  async setLastPullAt(id: string, at?: Date): Promise<void> {
    // updateMany: no-throw when the agent row vanished mid-event.
    await this.prisma.agent.updateMany({
      where: { id },
      data: { lastPullAt: at ?? new Date() },
    });
  }

  async setLastSyncAt(id: string): Promise<void> {
    await this.prisma.agent.updateMany({
      where: { id },
      data: { lastSyncAt: new Date() },
    });
  }

  async setWorkflowId(
    id: string,
    workflowId: string | null,
  ): Promise<IAgentData> {
    const record = await this.prisma.agent.update({
      where: { id },
      data: { workflowId },
    });
    return this.mapper.toEntity(record);
  }

  async setAdmin(id: string, enabled: boolean): Promise<IAgentData> {
    if (!enabled) {
      const record = await this.prisma.agent.update({
        where: { id },
        data: { isAdmin: false },
      });
      return this.mapper.toEntity(record);
    }
    // Single-admin invariant — clear the flag from any other agent first.
    const [, record] = await this.prisma.$transaction([
      this.prisma.agent.updateMany({
        where: { isAdmin: true, NOT: { id } },
        data: { isAdmin: false },
      }),
      this.prisma.agent.update({
        where: { id },
        data: { isAdmin: true },
      }),
    ]);
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.agent.delete({ where: { id } });
    this.statusChanges.emit({
      agentId: id,
      status: 'deleted',
      reason: null,
      at: new Date(),
    });
  }
}
