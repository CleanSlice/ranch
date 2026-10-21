import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SettingController } from './setting.controller';
import { ISettingGateway } from './domain/setting.gateway';
import { IInfraConfigGateway } from './domain/infraConfig.gateway';
import { IApiInstanceGateway } from './domain/apiInstance.gateway';
import { ApiInstanceService } from './domain/apiInstance.service';
import { SettingGateway } from './data/setting.gateway';
import { InfraConfigGateway } from './data/infraConfig.gateway';
import { ApiInstanceGateway } from './data/apiInstance.gateway';
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
    {
      provide: IApiInstanceGateway,
      useClass: ApiInstanceGateway,
    },
    ApiInstanceService,
  ],
  exports: [ISettingGateway, IInfraConfigGateway, ApiInstanceService],
})
export class SettingModule {}
