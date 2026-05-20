import { Injectable } from '@nestjs/common';
import type { IntegrationAccount } from '@prisma/client';
import {
  IIntegrationAccountData,
  ICreateIntegrationAccountData,
  IntegrationMechanismTypes,
  IntegrationStatusTypes,
} from '../domain/integration.types';

/**
 * Defence in depth around the aliases array — owner is dropped to avoid
 * a runtime fan-out writing to its own canonical path twice, blanks
 * removed, duplicates collapsed, and the array clamped at 16 entries
 * (reasonable real-world limit; if anyone needs more they can paginate).
 */
export function sanitizeAliases(
  aliases: string[],
  ownerId: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of aliases) {
    const trimmed = (a ?? '').trim();
    if (!trimmed || trimmed === ownerId || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= 16) break;
  }
  return out;
}

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
      aliases: record.aliases ?? [],
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
      aliases: sanitizeAliases(data.aliases ?? [], data.userId),
    };
  }
}
