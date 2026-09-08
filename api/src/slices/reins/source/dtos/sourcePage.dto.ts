import { ApiProperty } from '@nestjs/swagger';
import { ISourcePage } from '../domain/source.types';
import { SourceDto } from './source.dto';

export class SourcePageDto implements Omit<ISourcePage, 'items'> {
  @ApiProperty({ type: [SourceDto] }) items: SourceDto[];
  @ApiProperty({ description: 'Rows matching the filter across all pages' })
  total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}
