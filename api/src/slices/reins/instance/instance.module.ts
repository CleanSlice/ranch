import { Module } from '@nestjs/common';
import { SettingModule } from '#/setting/setting.module';
import { PodModule } from '#/agent/pod/pod.module';
import { ConfigModule } from '../config/config.module';
import { IInstanceGateway } from './domain/instance.gateway';
import { ArgoInstanceGateway } from './data/argoInstance.gateway';
import { MockInstanceGateway } from './data/mockInstance.gateway';
import { RouterInstanceGateway } from './data/routerInstance.gateway';

@Module({
  imports: [SettingModule, PodModule, ConfigModule],
  providers: [
    ArgoInstanceGateway,
    MockInstanceGateway,
    { provide: IInstanceGateway, useClass: RouterInstanceGateway },
  ],
  exports: [IInstanceGateway],
})
export class InstanceModule {}
