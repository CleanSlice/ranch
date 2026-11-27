import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { DEFAULT_PERIOD, PERIODS, Period } from '../domain';

/**
 * Query of `GET /stats/installation` (CLEAN-265; spec 038, contracts/api.md).
 *
 * The period and nothing else. There is no zone: an installation's days are
 * UTC days for everybody, so two administrators see the same numbers
 * (FR-029). There is no agent and no person either: which agents are
 * counted is the caller's reach, read from the token, and a parameter that
 * tried to say otherwise is not a property of this class, so the validation
 * pipe drops it (`whitelist`) before the handler runs.
 */
export class InstallationStatsQueryDto {
  @ApiPropertyOptional({
    enum: PERIODS,
    default: DEFAULT_PERIOD,
    description: 'Days in the period. Anything else is a 400.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(PERIODS)
  period?: Period;
}
