import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
} from 'class-validator';
import { IMPORT_MAX_FILES } from '../domain/file.limits';

/** Body of `POST /agents/:id/files/import/resolve` (CLEAN-192). */
export class ImportResolveRequestDto {
  @ApiProperty({
    type: [String],
    example: ['SOUL.md', 'SKILL.md', 'notes.txt'],
    description: 'Names of the dropped files, as the browser reports them.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(IMPORT_MAX_FILES)
  @IsString({ each: true })
  names!: string[];

  @ApiPropertyOptional({
    example: 'skills/research',
    description: 'Relative folder for names that match nothing; empty = root.',
  })
  @IsOptional()
  @IsString()
  targetFolder?: string;
}

const RESOLVE_MATCHES = ['unique', 'none', 'ambiguous'] as const;

export class ImportResolveRowDto {
  @ApiProperty({ example: 'SKILL.md' })
  name!: string;

  @ApiProperty({ enum: RESOLVE_MATCHES })
  match!: (typeof RESOLVE_MATCHES)[number];

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'unique → the matched path; none → <targetFolder>/<name>; ambiguous → null.',
  })
  path!: string | null;

  @ApiProperty({
    type: [String],
    example: ['skills/research/SKILL.md', 'skills/writer/SKILL.md'],
    description: 'ambiguous only: the matching paths, sorted.',
  })
  candidates!: string[];

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'unique only: size of the matched file.',
  })
  size!: number | null;
}

export class ImportResolveResponseDto {
  @ApiProperty({ example: '' })
  targetFolder!: string;

  @ApiProperty({ type: [ImportResolveRowDto] })
  rows!: ImportResolveRowDto[];
}
