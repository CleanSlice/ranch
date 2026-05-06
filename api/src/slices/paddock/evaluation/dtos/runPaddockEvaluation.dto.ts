import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RunPaddockJudgeOverrideDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  credentialIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  threshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxLlmCalls?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxTimeMs?: number;
}

export class RunPaddockEvaluationDto {
  @ApiProperty()
  @IsString()
  agentId: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Optional subset of scenario IDs. If omitted, runs the agent’s template scenarios merged with agent overrides.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scenarioIds?: string[];

  @ApiPropertyOptional({ type: RunPaddockJudgeOverrideDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RunPaddockJudgeOverrideDto)
  judgeOverride?: RunPaddockJudgeOverrideDto;
}
