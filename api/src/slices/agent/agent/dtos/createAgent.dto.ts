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
import { SetAgentLimitsDto } from '#/agent/limit/dtos';

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
    type: SetAgentLimitsDto,
    nullable: true,
    description:
      'Request limits, saved together with the rest (CLEAN-224). A public ' +
      'agent needs at least one: making an agent public without limits, or ' +
      'removing the last limit from a public one, is refused with ' +
      'PUBLIC_AGENT_NEEDS_LIMITS. Null switches limits off; absent leaves ' +
      'them as they are.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SetAgentLimitsDto)
  limits?: SetAgentLimitsDto | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  knowledgeIds?: string[];

  @ApiPropertyOptional({
    description:
      'When true, the agent is created as the Ranch admin on first deploy: any existing admin is demoted (and redeployed without RANCH_ADMIN), and this agent boots with RANCH_ADMIN=true + a service token. Single-admin invariant is enforced.',
  })
  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;
}
