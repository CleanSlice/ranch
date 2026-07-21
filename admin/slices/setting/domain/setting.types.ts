// Domain types for platform settings.

export type SettingValueTypes = 'string' | 'json';

export interface ISettingData {
  id: string;
  group: string;
  name: string;
  valueType: SettingValueTypes;
  value: unknown;
  updatedAt: string;
}
