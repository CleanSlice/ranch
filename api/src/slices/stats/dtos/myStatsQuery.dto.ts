import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Allow, IsIn, IsOptional } from 'class-validator';
import { DEFAULT_PERIOD, PERIODS, Period } from '../domain';

/**
 * Query of `GET /me/stats` (CLEAN-258; spec 038, contracts/api.md).
 *
 * Nothing here says whose statistics: the person is the token's, always
 * (FR-020). A parameter that tried (`userId`, `clientId`, `externalUserId`)
 * is not a property of this class, and the validation pipe drops what is
 * not (`whitelist`), so it never reaches the handler.
 */
export class MyStatsQueryDto {
  @ApiPropertyOptional({
    enum: PERIODS,
    default: DEFAULT_PERIOD,
    description: 'Days in the period. Anything else is a 400.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(PERIODS)
  period?: Period;

  @ApiPropertyOptional({
    type: String,
    example: 'Europe/Kyiv',
    description:
      "The viewer's IANA time zone: a person's days are cut on their own " +
      'clock. A name this server does not know, or anything that is not a ' +
      'name, is read as `UTC` and never refused; `timeZone` in the answer ' +
      'says which zone was used.',
  })
  // No rule on purpose: a wrong zone is answered in UTC, not with an error
  // (contracts/api.md), and `resolveZone` takes whatever arrives. `@Allow`
  // only keeps the pipe's whitelist from dropping the property.
  @Allow()
  tz?: unknown;
}
