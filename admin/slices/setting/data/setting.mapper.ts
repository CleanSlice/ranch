import type {
  ISettingData,
  SettingValueTypes,
} from '../domain/setting.types';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Maps the settings API onto domain shapes; reads defensively. */
export class SettingMapper {
  toList(raw: unknown): ISettingData[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => this.toEntity(item))
      .filter((s): s is ISettingData => s !== null);
  }

  toEntity(raw: unknown): ISettingData | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    return {
      id: o.id,
      group: str(o.group),
      name: str(o.name),
      valueType: o.valueType === 'json' ? 'json' : 'string',
      value: o.value,
      updatedAt: str(o.updatedAt),
    };
  }

  // Type-only helper: the domain's `value: unknown` doesn't satisfy the DTO's
  // `{ [key: string]: unknown }`, so cast at the boundary.
  toValueDto<T>(value: unknown): T {
    return value as T;
  }

  toValueTypeDto(valueType: SettingValueTypes): SettingValueTypes {
    return valueType;
  }
}
