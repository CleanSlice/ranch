import { Injectable } from '@nestjs/common';
import { S3Repository } from '#/aws/s3';
import { ISourceObjectStore } from '../domain/textExtraction.gateway';
import { IObjectLocation } from '../domain/textExtraction.types';

/** Source files and their `.ocr.txt` companions live in the same bucket. */
@Injectable()
export class S3ObjectStore extends ISourceObjectStore {
  constructor(private readonly s3: S3Repository) {
    super();
  }

  locate(uri: string): IObjectLocation {
    const { bucket, key } = S3Repository.parseUri(uri);
    return { bucket, key };
  }

  read(uri: string): Promise<Buffer> {
    return this.s3.download(S3Repository.parseUri(uri));
  }

  async writeText(uri: string, text: string): Promise<void> {
    const { bucket, key } = S3Repository.parseUri(uri);
    await this.s3.upload({
      bucket,
      key,
      body: Buffer.from(text, 'utf8'),
      contentType: 'text/plain; charset=utf-8',
    });
  }
}
