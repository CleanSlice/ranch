import type { ISettingGateway } from './setting.gateway';
import type { ISettingData, SettingValueTypes } from './setting.types';

/**
 * Domain service for platform settings. The store layers the reactive list +
 * the synchronous get/getValue lookups on top.
 */
export class SettingService {
  constructor(private gateway: ISettingGateway) {}

  list(): Promise<ISettingData[]> {
    return this.gateway.list();
  }

  upsert(
    group: string,
    name: string,
    value: unknown,
    valueType: SettingValueTypes,
  ): Promise<ISettingData> {
    return this.gateway.upsert(group, name, value, valueType);
  }

  remove(group: string, name: string): Promise<void> {
    return this.gateway.remove(group, name);
  }
}
