import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaddockScenarioMessageDto {
  @ApiProperty()
  @IsString()
  text: string;

  @ApiProperty()
  @IsString()
  from: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  delayMs?: number;
}

export class CreatePaddockSuccessCriterionDto {
  @ApiProperty({
    enum: [
      'correctness',
      'tool_usage',
      'soul_compliance',
      'response_quality',
      'error_handling',
    ],
  })
  @IsIn([
    'correctness',
    'tool_usage',
    'soul_compliance',
    'response_quality',
    'error_handling',
  ])
  dimension: string;

  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(1)
  weight: number;
}

export class CreatePaddockScenarioSetupDto {
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  @IsOptional()
  @IsObject()
  files?: Record<string, string>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  @IsOptional()
  @IsObject()
  env?: Record<string, string>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tools?: string[];
}

export class CreatePaddockScenarioDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  templateId?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  agentId?: string | null;

  @ApiProperty({
    enum: [
      'tool_use',
      'memory',
      'conversation',
      'patching_workflow',
      'edge_case',
      'multi_turn',
      'error_recovery',
    ],
  })
  @IsIn([
    'tool_use',
    'memory',
    'conversation',
    'patching_workflow',
    'edge_case',
    'multi_turn',
    'error_recovery',
  ])
  category: string;

  @ApiProperty({ enum: ['easy', 'medium', 'hard', 'adversarial'] })
  @IsIn(['easy', 'medium', 'hard', 'adversarial'])
  difficulty: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty()
  @IsString()
  expectedBehavior: string;

  @ApiProperty({ type: [CreatePaddockScenarioMessageDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePaddockScenarioMessageDto)
  messages: CreatePaddockScenarioMessageDto[];

  @ApiProperty({ type: [CreatePaddockSuccessCriterionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePaddockSuccessCriterionDto)
  successCriteria: CreatePaddockSuccessCriterionDto[];

  @ApiPropertyOptional({ type: () => CreatePaddockScenarioSetupDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePaddockScenarioSetupDto)
  setup?: CreatePaddockScenarioSetupDto | null;
}
