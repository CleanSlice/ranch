import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateTemplateDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty({ example: 'ghcr.io/org/agent:latest' })
  @IsString()
  image: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  defaultConfig?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  defaultResources?: { cpu: string; memory: string };

  // Paddock runtime config — passThreshold, maxIterations, scenarios, etc.
  // Was missing before; without it the global ValidationPipe (whitelist:true)
  // silently dropped this field from PUT /templates/:id, and updates appeared
  // to be ignored.
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  paddockConfig?: Record<string, unknown>;
}
