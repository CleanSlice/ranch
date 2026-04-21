import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn } from 'class-validator';

export class CreateLlmCredentialDto {
  @ApiProperty({ example: 'anthropic' })
  @IsString()
  provider: string;

  @ApiProperty({ example: 'claude-sonnet-4-6' })
  @IsString()
  model: string;

  @ApiProperty()
  @IsString()
  apiKey: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ enum: ['active', 'disabled'] })
  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: string;
}
