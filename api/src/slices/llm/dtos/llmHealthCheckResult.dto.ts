import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LlmHealthCheckResultDto {
  @ApiProperty({ example: true })
  ok: boolean;

  @ApiProperty({ example: 482 })
  latencyMs: number;

  @ApiProperty({ example: 'anthropic' })
  provider: string;

  @ApiProperty({ example: 'claude-sonnet-4-6' })
  model: string;

  @ApiPropertyOptional({ example: 'Anthropic 401: invalid x-api-key' })
  error?: string;
}
