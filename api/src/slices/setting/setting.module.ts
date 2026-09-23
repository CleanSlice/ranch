import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SettingController } from './setting.controller';
import { ISettingGateway } from './domain/setting.gateway';
import { IInfraConfigGateway } from './domain/infraConfig.gateway';
import { SettingGateway } from './data/setting.gateway';
import { InfraConfigGateway } from './data/infraConfig.gateway';
import { SettingMapper } from './data/setting.mapper';
import { SettingTool } from './setting.tool';

@Module({
  imports: [ConfigModule],
  controllers: [SettingController],
  providers: [
    SettingMapper,
    SettingTool,
    {
      provide: ISettingGateway,
      useClass: SettingGateway,
    },
    {
      provide: IInfraConfigGateway,
      useClass: InfraConfigGateway,
    },
  ],
  exports: [ISettingGateway, IInfraConfigGateway],
})
export class SettingModule {}
