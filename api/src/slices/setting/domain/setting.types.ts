export type SettingValueTypes = 'string' | 'json';

export interface ISettingData {
  id: string;
  group: string;
  name: string;
  valueType: SettingValueTypes;
  value: unknown;
  updatedAt: Date;
}

export interface IUpsertSettingData {
  valueType: SettingValueTypes;
  value: unknown;
}
