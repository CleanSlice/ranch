import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PaddockScenarioMessageDto {
  @ApiProperty()
  text: string;

  @ApiProperty()
  from: string;

  @ApiPropertyOptional()
  delayMs?: number;
}

export class PaddockSuccessCriterionDto {
  @ApiProperty({
    enum: [
      'correctness',
      'tool_usage',
      'soul_compliance',
      'response_quality',
      'error_handling',
    ],
  })
  dimension: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  weight: number;
}

export class PaddockScenarioSetupDto {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  files?: Record<string, string>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  env?: Record<string, string>;

  @ApiPropertyOptional({ type: [String] })
  tools?: string[];
}

export class PaddockScenarioDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  templateId: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  agentId: string | null;

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
  category: string;

  @ApiProperty({ enum: ['easy', 'medium', 'hard', 'adversarial'] })
  difficulty: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  expectedBehavior: string;

  @ApiProperty({ type: [PaddockScenarioMessageDto] })
  messages: PaddockScenarioMessageDto[];

  @ApiProperty({ type: [PaddockSuccessCriterionDto] })
  successCriteria: PaddockSuccessCriterionDto[];

  @ApiPropertyOptional({ type: () => PaddockScenarioSetupDto, nullable: true })
  setup: PaddockScenarioSetupDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
