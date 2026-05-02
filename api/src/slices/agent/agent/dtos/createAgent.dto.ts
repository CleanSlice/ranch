import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsObject,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class AgentResourcesDto {
  @ApiProperty({ example: '500m' })
  @IsString()
  cpu: string;

  @ApiProperty({ example: '512Mi' })
  @IsString()
  memory: string;
}

export class CreateAgentDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  templateId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  llmCredentialId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => AgentResourcesDto)
  resources?: AgentResourcesDto;

  @ApiPropertyOptional({
    description:
      'When true, the agent is visible on the public landing page to unauthenticated visitors.',
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
