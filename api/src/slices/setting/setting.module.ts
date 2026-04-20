import { Module } from '@nestjs/common';
import { SettingController } from './setting.controller';
import { ISettingGateway } from './domain/setting.gateway';
import { SettingGateway } from './data/setting.gateway';
import { SettingMapper } from './data/setting.mapper';

@Module({
  controllers: [SettingController],
  providers: [
    SettingMapper,
    {
      provide: ISettingGateway,
      useClass: SettingGateway,
    },
  ],
  exports: [ISettingGateway],
})
export class SettingModule {}
