import { ApiProperty } from '@nestjs/swagger';

export class PaddockJudgeScoreDto {
  @ApiProperty()
  judgeModel: string;

  @ApiProperty({
    description:
      'Per-dimension numeric scores (correctness, tool_usage, soul_compliance, response_quality, error_handling).',
  })
  scores: Record<string, number>;

  @ApiProperty()
  reasoning: Record<string, string>;

  @ApiProperty()
  overallScore: number;

  @ApiProperty({ enum: ['pass', 'fail', 'partial', 'skipped'] })
  verdict: string;

  @ApiProperty()
  confidence: number;

  @ApiProperty({ type: [String] })
  suggestions: string[];
}

export class PaddockEvaluationResultDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  evaluationId: string;

  @ApiProperty()
  scenarioId: string;

  @ApiProperty({ enum: ['pass', 'fail', 'partial', 'skipped'] })
  verdict: string;

  @ApiProperty()
  finalScore: number;

  @ApiProperty()
  agreement: number;

  @ApiProperty()
  dimensionScores: Record<string, number>;

  @ApiProperty({ type: [PaddockJudgeScoreDto] })
  judges: PaddockJudgeScoreDto[];

  @ApiProperty({ type: [String] })
  failureReasons: string[];
}
