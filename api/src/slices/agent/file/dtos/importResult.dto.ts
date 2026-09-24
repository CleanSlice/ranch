import { ApiProperty } from '@nestjs/swagger';

export class ImportFailureDto {
  @ApiProperty({ example: 'workspace/big.bin' })
  path!: string;

  @ApiProperty({ example: 'S3 put failed: AccessDenied' })
  reason!: string;
}

export class ImportResultDto {
  @ApiProperty({ format: 'uuid' })
  importId!: string;

  @ApiProperty({ enum: ['merge', 'replace'] })
  mode!: 'merge' | 'replace';

  @ApiProperty({ example: 15 })
  written!: number;

  @ApiProperty({ example: 0 })
  removed!: number;

  @ApiProperty({ example: 2 })
  skipped!: number;

  @ApiProperty({ type: [ImportFailureDto] })
  failed!: ImportFailureDto[];

  @ApiProperty({
    description: 'The agent is running — the files apply on its next restart.',
  })
  restartRequired!: boolean;
}

export class ImportRemoveConflictDto {
  @ApiProperty({ example: true })
  requiresConfirmation!: true;

  @ApiProperty({ example: 7, description: 'Files replace mode would delete.' })
  remove!: number;
}
