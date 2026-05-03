import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class GeneratePaddockScenarioDto {
  @ApiProperty({
    description:
      'Free-form description of the problem / behavior the user wants to test.',
  })
  @IsString()
  description: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  templateId?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  agentId?: string | null;

  @ApiPropertyOptional({
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
  @IsOptional()
  @IsIn([
    'tool_use',
    'memory',
    'conversation',
    'patching_workflow',
    'edge_case',
    'multi_turn',
    'error_recovery',
  ])
  category?: string;

  @ApiPropertyOptional({ enum: ['easy', 'medium', 'hard', 'adversarial'] })
  @IsOptional()
  @IsIn(['easy', 'medium', 'hard', 'adversarial'])
  difficulty?: string;

  @ApiPropertyOptional({
    description:
      'Optional LlmCredential id; if omitted, the first active Anthropic credential is used.',
  })
  @IsOptional()
  @IsString()
  credentialId?: string;
}
