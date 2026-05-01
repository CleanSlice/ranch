import { Module, forwardRef } from '@nestjs/common';
import { AgentModule } from '#/agent/agent/agent.module';
import { SettingModule } from '#/setting/setting.module';
import { BridleModule } from '#/bridle/bridle.module';
import { FileController } from './file.controller';
import { IFileGateway } from './domain/file.gateway';
import { S3FileGateway } from './data/file.gateway';

// AgentModule must be a forwardRef here because BridleModule (which imports
// FileModule) is now also imported by AgentModule, creating
// AgentModule → BridleModule → FileModule → AgentModule.
@Module({
  imports: [
    forwardRef(() => AgentModule),
    SettingModule,
    forwardRef(() => BridleModule),
  ],
  controllers: [FileController],
  providers: [
    {
      provide: IFileGateway,
      useClass: S3FileGateway,
    },
  ],
  exports: [IFileGateway],
})
export class FileModule {}
