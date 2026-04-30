import { Module } from '@nestjs/common';
import { AgentModule } from '#/agent/agent/agent.module';
import { SettingModule } from '#/setting/setting.module';
import { FileController } from './file.controller';
import { IFileGateway } from './domain/file.gateway';
import { S3FileGateway } from './data/file.gateway';

@Module({
  imports: [AgentModule, SettingModule],
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
