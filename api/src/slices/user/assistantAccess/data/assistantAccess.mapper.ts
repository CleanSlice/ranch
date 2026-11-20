import { Injectable } from '@nestjs/common';
import type {
  AssistantAccountAccess,
  AssistantRoleAccess,
} from '@prisma/client';
import { isAssistantLevel } from '../domain/assistantLevels';
import type {
  AssistantLevelOrCustom,
  IAssistantAccountData,
  IAssistantCustom,
  IAssistantSettingData,
} from '../domain/assistantAccess.types';

type Row = Pick<
  AssistantRoleAccess,
  'enabled' | 'level' | 'custom' | 'updatedById' | 'updatedAt'
>;

@Injectable()
export class AssistantAccessMapper {
  toSetting(row: Row): IAssistantSettingData {
    const custom = this.toCustom(row.custom);
    return {
      enabled: row.enabled,
      level: this.toLevel(row.level, custom),
      custom,
      updatedById: row.updatedById,
      updatedAt: row.updatedAt,
    };
  }

  toAccount(row: AssistantAccountAccess): IAssistantAccountData {
    return { userId: row.userId, ...this.toSetting(row) };
  }

  /**
   * A level the code no longer knows, or `custom` with nothing stored, reads
   * as Basic: the narrowest thing a broken row can mean.
   */
  private toLevel(
    value: string,
    custom: IAssistantCustom | null,
  ): AssistantLevelOrCustom {
    if (value === 'custom') return custom ? 'custom' : 'basic';
    return isAssistantLevel(value) ? value : 'basic';
  }

  private toCustom(value: unknown): IAssistantCustom | null {
    if (!value || typeof value !== 'object') return null;
    const o = value as Record<string, unknown>;
    const strings = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string')
        : [];
    return { on: strings(o.on), known: strings(o.known) };
  }
}
