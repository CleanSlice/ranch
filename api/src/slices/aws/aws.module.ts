import { Module } from '@nestjs/common';
import { S3Module } from './s3/s3.module';
import { TextractModule } from './textract/textract.module';

@Module({
  imports: [S3Module, TextractModule],
  exports: [S3Module, TextractModule],
})
export class AwsModule {}
