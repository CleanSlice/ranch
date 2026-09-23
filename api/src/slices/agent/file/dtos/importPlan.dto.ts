import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

const IMPORT_ACTIONS = ['add', 'change', 'unchanged', 'remove', 'skip'] as const;

export class ImportPlanEntryDto {
  @ApiProperty({ example: 'skills/run.py' })
  path!: string;

  @ApiProperty({ enum: IMPORT_ACTIONS })
  action!: (typeof IMPORT_ACTIONS)[number];

  @ApiProperty({ example: 1024 })
  size!: number;

  @ApiPropertyOptional({
    example: 'runtime-owned session state',
    description: 'Why the entry is skipped or treated as changed.',
  })
  reason?: string;
}

export class ImportCountsDto {
  @ApiProperty({ example: 12 })
  add!: number;

  @ApiProperty({ example: 3 })
  change!: number;

  @ApiProperty({ example: 160 })
  unchanged!: number;

  @ApiProperty({ example: 0, description: 'Replace mode only.' })
  remove!: number;

  @ApiProperty({ example: 2 })
  skip!: number;
}

export class ImportPlanDto {
  @ApiProperty({ format: 'uuid' })
  importId!: string;

  @ApiProperty({ enum: ['merge', 'replace'] })
  mode!: 'merge' | 'replace';

  @ApiProperty()
  includeSessions!: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Top-level folder removed from every entry, if the archive had one.',
  })
  wrapperStripped!: string | null;

  @ApiProperty({ type: ImportCountsDto })
  counts!: ImportCountsDto;

  @ApiProperty({ description: 'Bytes of the entries that will be written.' })
  totalBytes!: number;

  @ApiProperty({
    type: [ImportPlanEntryDto],
    description: 'Capped at the plan list limit; `more` counts the rest.',
  })
  entries!: ImportPlanEntryDto[];

  @ApiProperty({ example: 0 })
  more!: number;

  @ApiProperty({ type: [String] })
  warnings!: string[];
}

/** Query of `GET /agents/:id/files/import/:importId/plan`. */
export class ImportPlanQueryDto {
  @ApiPropertyOptional({ enum: ['merge', 'replace'], default: 'merge' })
  @IsOptional()
  @IsIn(['merge', 'replace'])
  mode?: 'merge' | 'replace';

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeSessions?: boolean;
}
