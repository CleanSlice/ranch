import { Injectable } from '@nestjs/common';
import { Setting } from '@prisma/client';
import { ISettingData, SettingValueTypes } from '../domain';

@Injectable()
export class SettingMapper {
  toEntity(record: Setting): ISettingData {
    const valueType = record.valueType as SettingValueTypes;
    return {
      id: record.id,
      group: record.group,
      name: record.name,
      valueType,
      value: this.decode(valueType, record.value),
      updatedAt: record.updatedAt,
    };
  }

  encode(valueType: SettingValueTypes, value: unknown): string {
    if (valueType === 'json') return JSON.stringify(value ?? null);
    return value == null ? '' : String(value);
  }

  private decode(valueType: SettingValueTypes, raw: string): unknown {
    if (valueType === 'json') {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return raw;
  }
}
