import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsObject } from 'class-validator';

export class ReportUsageDto {
  @ApiProperty({ example: '2026-04-22' })
  @IsString()
  date: string;

  @ApiProperty({
    description:
      'Per-model usage. Key is the canonical model name (e.g. claude-sonnet-4-6).',
    example: {
      'claude-sonnet-4-6': {
        inputTokens: 12345,
        outputTokens: 6789,
        callCount: 42,
      },
    },
  })
  @IsObject()
  byModel: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      callCount: number;
      llmCredentialId?: string;
    }
  >;
}
