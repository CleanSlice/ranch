import { Module, forwardRef } from '@nestjs/common';
import { AwsModule } from '#/aws/aws.module';
import { ConfigModule } from '../config/config.module';
import { SourceModule } from '../source/source.module';
import { TextExtractionService } from './domain/textExtraction.service';
import {
  IPdfTextProbe,
  ISourceObjectStore,
  ITextExtractionGateway,
} from './domain/textExtraction.gateway';
import { PdfParseProbe } from './data/pdfParse.probe';
import { S3ObjectStore } from './data/s3Object.store';
import { TextractExtractionGateway } from './data/textractExtraction.gateway';

// SourceModule schedules extractions after it creates a PDF row, and this
// module writes the result back through SourceModule's gateway: a genuine
// pair, wired with forwardRef the way the other circular slices are.
@Module({
  imports: [AwsModule, ConfigModule, forwardRef(() => SourceModule)],
  providers: [
    TextExtractionService,
    { provide: IPdfTextProbe, useClass: PdfParseProbe },
    { provide: ITextExtractionGateway, useClass: TextractExtractionGateway },
    { provide: ISourceObjectStore, useClass: S3ObjectStore },
  ],
  exports: [TextExtractionService],
})
export class ExtractionModule {}
