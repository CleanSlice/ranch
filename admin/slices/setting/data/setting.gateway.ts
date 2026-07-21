import { SettingsService } from '#api/data';
import type { UpsertSettingDto } from '#api/data/repositories/api/types.gen';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { ISettingGateway } from '../domain/setting.gateway';
import type { ISettingData, SettingValueTypes } from '../domain/setting.types';
import { SettingMapper } from './setting.mapper';

export class SettingGateway extends BaseGateway implements ISettingGateway {
  private mapper = new SettingMapper();

  list(): Promise<ISettingData[]> {
    return this.execute(async () => {
      const res = await SettingsService.settingControllerFindAll();
      return this.mapper.toList(unwrapEnvelope(res.data));
    });
  }

  upsert(
    group: string,
    name: string,
    value: unknown,
    valueType: SettingValueTypes,
  ): Promise<ISettingData> {
    return this.execute(async () => {
      const res = await SettingsService.settingControllerUpsert({
        path: { group, name },
        body: {
          valueType,
          value: this.mapper.toValueDto<UpsertSettingDto['value']>(value),
        },
      });
      const entity = this.mapper.toEntity(unwrapEnvelope(res.data));
      if (!entity) throw new Error('Setting upsert returned no data');
      return entity;
    });
  }

  remove(group: string, name: string): Promise<void> {
    return this.execute(async () => {
      await SettingsService.settingControllerRemove({ path: { group, name } });
    });
  }
}
