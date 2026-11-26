import { Injectable } from '@nestjs/common';
import { Usage } from '@prisma/client';
import { IUsageData } from '../domain';

interface IUsageEntry {
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  llmCredentialId?: string;
}

interface IUsageCreateInput {
  agentId: string;
  agentName: string | null;
  model: string;
  date: Date;
  entry: IUsageEntry;
}

@Injectable()
export class UsageMapper {
  toEntity(record: Usage): IUsageData {
    return {
      id: record.id,
      agentId: record.agentId,
      agentName: record.agentName,
      llmCredentialId: record.llmCredentialId,
      model: record.model,
      date: record.date,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      callCount: record.callCount,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate({ agentId, agentName, model, date, entry }: IUsageCreateInput) {
    return {
      id: `usage-${crypto.randomUUID()}`,
      agentId,
      agentName,
      model,
      date,
      llmCredentialId: entry.llmCredentialId ?? null,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      callCount: entry.callCount,
    };
  }

  // The name is rewritten with every report, which is how a rename reaches
  // a row that is already there (CLEAN-261). A report that comes without a
  // name leaves the column out instead of clearing it: the last report of an
  // agent being deleted arrives after its record is gone, and would otherwise
  // erase the one thing the row is kept readable by.
  toUpdate(entry: IUsageEntry, agentName: string | null) {
    return {
      ...(agentName === null ? {} : { agentName }),
      llmCredentialId: entry.llmCredentialId ?? null,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      callCount: entry.callCount,
    };
  }
}
