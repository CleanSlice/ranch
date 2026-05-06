import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaddockEvaluationResultDto } from './paddockEvaluationResult.dto';

export class PaddockJudgeConfigDto {
  @ApiProperty({ type: [String] })
  credentialIds: string[];

  @ApiProperty()
  threshold: number;

  @ApiProperty()
  maxLlmCalls: number;

  @ApiProperty()
  maxTimeMs: number;
}

export class PaddockEvaluationScenarioSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  category: string;

  @ApiProperty()
  difficulty: string;
}

export class PaddockEvaluationDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  agentId: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  templateId: string | null;

  @ApiProperty({ enum: ['running', 'done', 'failed', 'aborted'] })
  status: string;

  @ApiProperty()
  startedAt: Date;

  @ApiPropertyOptional({ nullable: true, type: String })
  finishedAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'When status=running, the id of the scenario currently being evaluated. Polled UIs use this to highlight progress.',
  })
  currentScenarioId: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  passRate: number | null;

  @ApiProperty()
  scenarioCount: number;

  @ApiProperty()
  passCount: number;

  @ApiProperty()
  failCount: number;

  @ApiProperty()
  partialCount: number;

  @ApiProperty()
  skippedCount: number;

  @ApiProperty({ type: PaddockJudgeConfigDto })
  judgeConfig: PaddockJudgeConfigDto;

  @ApiProperty({
    type: [PaddockEvaluationScenarioSummaryDto],
    description:
      'Slim summary of scenarios that were captured at run start (id, name, description, category, difficulty). Used by progress UIs while the eval is running.',
  })
  scenarios: PaddockEvaluationScenarioSummaryDto[];

  @ApiPropertyOptional({ nullable: true, type: String })
  reportS3Key: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  errorMessage: string | null;

  @ApiProperty({ type: [PaddockEvaluationResultDto] })
  results: PaddockEvaluationResultDto[];
}
