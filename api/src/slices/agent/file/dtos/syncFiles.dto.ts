import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class SyncFilesBodyDto {
  @ApiPropertyOptional({
    description:
      'Set to true to run the sync even when at-risk files were reported ' +
      '(the operator explicitly accepted the overwrite risk). Without it a ' +
      'non-empty at-risk list makes the endpoint answer 409 and skip the sync.',
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

export class AtRiskFileDto {
  @ApiProperty({ example: 'SOUL.md' })
  path!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'When the S3 (shared) copy of this file was last modified',
  })
  updatedAt!: string;
}

export class SyncConflictDto {
  @ApiProperty({
    description:
      'Always true: the sync was NOT executed — resend with confirm=true to proceed',
  })
  requiresConfirmation!: boolean;

  @ApiProperty({
    type: [AtRiskFileDto],
    description:
      'S3 files modified after the pod last pulled/pushed. A sync MAY ' +
      'overwrite or delete them if the pod also changed them locally.',
  })
  atRisk!: AtRiskFileDto[];

  @ApiProperty({
    format: 'date-time',
    description:
      'Reference moment the S3 copies were compared against ' +
      '(max of last boot pull minus margin and last completed sync)',
  })
  baseline!: string;
}

export class SyncFilesDto {
  @ApiProperty({
    description:
      'Whether the agent runtime was online and acknowledged the sync. ' +
      'When false, the agent could not be reached — admin should still see ' +
      'the latest S3 state (no push happened).',
  })
  agentOnline!: boolean;

  @ApiProperty({
    description:
      'Number of files the agent pushed to S3 in this sync (0 if nothing changed or agent offline)',
  })
  pushed!: number;
}
