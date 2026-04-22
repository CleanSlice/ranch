import { Injectable } from '@nestjs/common';
import { LlmCredential } from '@prisma/client';
import { ILlmCredentialData } from '../domain';

@Injectable()
export class LlmMapper {
  toEntity(record: LlmCredential): ILlmCredentialData {
    return {
      id: record.id,
      provider: record.provider,
      model: record.model,
      fallbackModel: record.fallbackModel,
      label: record.label,
      apiKey: record.apiKey,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
