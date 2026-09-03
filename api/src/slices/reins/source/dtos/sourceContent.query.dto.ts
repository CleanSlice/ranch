import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export type ContentDispositionTypes = 'inline' | 'attachment';

const DISPOSITIONS: readonly ContentDispositionTypes[] = [
  'inline',
  'attachment',
];

export class SourceContentQueryDto {
  @ApiPropertyOptional({
    enum: DISPOSITIONS,
    default: 'inline',
    description:
      '"inline" lets the browser render what it can (pdf, images, text); "attachment" forces a download.',
  })
  @IsOptional()
  @IsIn(DISPOSITIONS)
  disposition?: ContentDispositionTypes;
}
