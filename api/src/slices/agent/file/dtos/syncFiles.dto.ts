import { ApiProperty } from '@nestjs/swagger';

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
