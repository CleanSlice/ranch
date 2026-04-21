import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UsageDailyEntryDto {
  @ApiProperty()
  date: string;

  @ApiProperty()
  model: string;

  @ApiProperty()
  inputTokens: number;

  @ApiProperty()
  outputTokens: number;

  @ApiProperty()
  callCount: number;

  @ApiProperty()
  costUsd: number;
}

export class UsageTotalsDto {
  @ApiProperty()
  inputTokens: number;

  @ApiProperty()
  outputTokens: number;

  @ApiProperty()
  callCount: number;

  @ApiProperty()
  costUsd: number;
}

export class UsageTodayDto {
  @ApiPropertyOptional()
  model: string | null;

  @ApiProperty()
  inputTokens: number;

  @ApiProperty()
  outputTokens: number;

  @ApiProperty()
  callCount: number;
}

export class AgentUsageDto {
  @ApiProperty({ type: [UsageDailyEntryDto] })
  last30days: UsageDailyEntryDto[];

  @ApiProperty({ type: UsageTotalsDto })
  totals: UsageTotalsDto;

  @ApiPropertyOptional()
  topModel: string | null;

  @ApiProperty({ type: UsageTodayDto })
  today: UsageTodayDto;
}
