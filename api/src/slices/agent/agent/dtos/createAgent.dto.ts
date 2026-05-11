import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsObject,
  IsBoolean,
  IsArray,
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

  @ApiPropertyOptional({
    type: [String],
    description:
      'Origins (scheme + host + port) authorized to open browser WebSockets to this bot without a JWT. Only consulted when isPublic=true.',
    example: ['https://bridle.cleanslice.org', 'http://localhost:5173'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedOrigins?: string[];

  @ApiPropertyOptional({
    description:
      'When true, the agent is created as the Ranch admin on first deploy: any existing admin is demoted (and redeployed without RANCH_ADMIN), and this agent boots with RANCH_ADMIN=true + a service token. Single-admin invariant is enforced.',
  })
  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;
}
