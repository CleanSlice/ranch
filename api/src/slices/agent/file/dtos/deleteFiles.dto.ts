import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';

export class DeleteFilesDto {
  @ApiProperty({
    example: 3,
    description: 'Number of S3 objects deleted by this request.',
  })
  deleted!: number;
}

/** Body of `DELETE /agents/:id/files` — a selection (CLEAN-112). */
export class DeleteFilesBodyDto {
  @ApiProperty({
    type: [String],
    description: 'Files, or folders (deleted recursively).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  paths!: string[];

  @ApiPropertyOptional({
    default: false,
    description:
      'Required when the selection would remove every file of the workspace.',
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

export class DeleteFilesConflictDto {
  @ApiProperty({ example: true })
  requiresConfirmation!: true;

  @ApiProperty({ example: 177 })
  wouldRemove!: number;

  @ApiProperty({ example: 177 })
  total!: number;
}
