import { Injectable } from '@nestjs/common';
import type { IntegrationAccount } from '@prisma/client';
import {
  IIntegrationAccountData,
  ICreateIntegrationAccountData,
  IntegrationMechanismTypes,
  IntegrationStatusTypes,
} from '../domain/integration.types';

@Injectable()
export class IntegrationMapper {
  toEntity(record: IntegrationAccount): IIntegrationAccountData {
    return {
      id: record.id,
      userId: record.userId,
      service: record.service,
      accountKey: record.accountKey,
      mechanism: record.mechanism as IntegrationMechanismTypes,
      label: record.label,
      status: record.status as IntegrationStatusTypes,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(data: ICreateIntegrationAccountData) {
    return {
      id: `integration-${crypto.randomUUID()}`,
      userId: data.userId,
      service: data.service,
      accountKey: data.accountKey,
      mechanism: data.mechanism,
      label: data.label ?? null,
      status: 'pending',
    };
  }
}
