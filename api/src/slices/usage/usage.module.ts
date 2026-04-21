import { Module } from '@nestjs/common';
import { UsageController } from './usage.controller';
import { IUsageGateway } from './domain/usage.gateway';
import { UsageGateway } from './data/usage.gateway';
import { UsageMapper } from './data/usage.mapper';
import { BridleApiKeyGuard } from './data/bridleApiKey.guard';

@Module({
  controllers: [UsageController],
  providers: [
    UsageMapper,
    BridleApiKeyGuard,
    {
      provide: IUsageGateway,
      useClass: UsageGateway,
    },
  ],
  exports: [IUsageGateway],
})
export class UsageModule {}
