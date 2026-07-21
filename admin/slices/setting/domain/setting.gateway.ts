import type { ISettingData, SettingValueTypes } from './setting.types';

/** Contract for platform settings. Implemented by `SettingGateway`. */
export abstract class ISettingGateway {
  abstract list(): Promise<ISettingData[]>;
  abstract upsert(
    group: string,
    name: string,
    value: unknown,
    valueType: SettingValueTypes,
  ): Promise<ISettingData>;
  abstract remove(group: string, name: string): Promise<void>;
}
