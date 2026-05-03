import { ApiProperty } from '@nestjs/swagger';

export class PaddockEvaluationReportDto {
  @ApiProperty({
    description: 'Structured JSON report (full state).',
    type: 'object',
    additionalProperties: true,
  })
  json: object;

  @ApiProperty({ description: 'Human-readable markdown report.' })
  md: string;
}
