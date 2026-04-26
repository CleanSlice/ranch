import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { S3Repository } from './s3.repository';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: S3Repository,
      inject: [ConfigService],
      useFactory: (config: ConfigService): S3Repository => {
        const accessKeyId = config.get<string>('S3_ACCESS_KEY');
        const secretAccessKey = config.get<string>('S3_SECRET_KEY');
        if (!accessKeyId || !secretAccessKey) {
          throw new Error(
            'S3Module: S3_ACCESS_KEY and S3_SECRET_KEY must be set',
          );
        }
        return new S3Repository({
          endpoint: config.get<string>('S3_ENDPOINT'),
          region: config.get<string>('S3_REGION', 'us-east-1'),
          accessKeyId,
          secretAccessKey,
        });
      },
    },
  ],
  exports: [S3Repository],
})
export class S3Module {}
