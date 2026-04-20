import { ISettingData, IUpsertSettingData } from './setting.types';

export abstract class ISettingGateway {
  abstract findAll(): Promise<ISettingData[]>;
  abstract findByGroup(group: string): Promise<ISettingData[]>;
  abstract findByKey(group: string, name: string): Promise<ISettingData | null>;
  abstract upsert(
    group: string,
    name: string,
    data: IUpsertSettingData,
  ): Promise<ISettingData>;
  abstract delete(group: string, name: string): Promise<void>;
}
