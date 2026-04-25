import { Module } from '@nestjs/common';
import { IPodGateway } from './domain/pod.gateway';
import { KubePodGateway } from './data/pod.gateway';

@Module({
  providers: [
    {
      provide: IPodGateway,
      useClass: KubePodGateway,
    },
  ],
  exports: [IPodGateway],
})
export class PodModule {}
