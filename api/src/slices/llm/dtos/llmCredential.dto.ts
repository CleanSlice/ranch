import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LlmCredentialDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'anthropic' })
  provider: string;

  @ApiProperty({ example: 'claude-sonnet-4-6' })
  model: string;

  @ApiPropertyOptional()
  fallbackModel: string | null;

  @ApiPropertyOptional()
  label: string | null;

  @ApiProperty()
  apiKey: string;

  @ApiProperty({ example: 'active', enum: ['active', 'disabled'] })
  status: string;

  @ApiProperty({ default: true })
  supportsChat: boolean;

  @ApiProperty({ default: false })
  supportsEmbedding: boolean;

  @ApiProperty({
    description:
      'True when the Ranch assistant is built from this resource (CLEAN-271): only the Owner can change it, and a console shows it read-only to anybody else.',
  })
  assistantDependency: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
