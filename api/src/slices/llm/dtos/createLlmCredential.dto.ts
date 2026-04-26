import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizeCredential } from '../domain/llm.utils';

export class CreateLlmCredentialDto {
  @ApiProperty({ example: 'anthropic' })
  @IsString()
  provider: string;

  @ApiProperty({ example: 'claude-sonnet-4-6' })
  @IsString()
  model: string;

  @ApiProperty()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeCredential(value) : value,
  )
  apiKey: string;

  @ApiPropertyOptional({ example: 'claude-haiku-4-5' })
  @IsOptional()
  @IsString()
  fallbackModel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ enum: ['active', 'disabled'] })
  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: string;
}
