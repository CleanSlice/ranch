import { ApiProperty } from '@nestjs/swagger';

export class TranscriptMessageDto {
  @ApiProperty({ example: 'c94dbcf2-64f1-4e84-9723-c94e2d815f61' })
  id: string;

  @ApiProperty({ enum: ['user', 'assistant'], example: 'assistant' })
  role: 'user' | 'assistant';

  @ApiProperty({ example: 'Hello, how can I help?' })
  text: string;

  @ApiProperty({
    example: 1777562539964,
    description: 'Unix epoch milliseconds.',
  })
  ts: number;
}

export class TranscriptResponseDto {
  @ApiProperty({ type: [TranscriptMessageDto] })
  messages: TranscriptMessageDto[];

  @ApiProperty({
    example: 'admin',
    description: 'Channel the transcript was loaded from.',
  })
  channel: string;
}
