import { Module } from '@nestjs/common';
import { SettingModule } from '#/setting/setting.module';
import { S3Repository } from './s3.repository';

@Module({
  imports: [SettingModule],
  providers: [S3Repository],
  exports: [S3Repository],
})
export class S3Module {}
