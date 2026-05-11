import { Module } from '@nestjs/common';
import { SettingModule } from '#/setting/setting.module';
import { IPodGateway } from './domain/pod.gateway';
import { KubePodGateway } from './data/pod.gateway';

@Module({
  imports: [SettingModule],
  providers: [
    {
      provide: IPodGateway,
      useClass: KubePodGateway,
    },
  ],
  exports: [IPodGateway],
})
export class PodModule {}
