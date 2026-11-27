import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { accessCallerOf } from '#/user/agentAccess/guards';
import { JwtAuthGuard, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import { DEFAULT_PERIOD, InstallationStatsService } from './domain';
import { InstallationStatsDto, InstallationStatsQueryDto } from './dtos';

/**
 * The installation's statistics, for those who run it (CLEAN-265; spec 038,
 * contracts/api.md, User Story 4).
 *
 * For the Owner and Admins only, and stated: what the agents cost and how
 * they fared is not a User's to read (FR-021), and a User asking gets 403.
 *
 * Which agents the figures cover is the caller's reach, taken from the token
 * (`accessCallerOf`) and applied by the service to every figure, totals
 * included. There is no parameter that names an agent or a person, so there
 * is nothing here to answer 404 about: an Admin limited to some agents gets
 * the same shape with those agents' numbers, and `reach.limited` says so.
 */
@ApiTags('stats')
@ApiBearerAuth()
@Controller('stats/installation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
export class InstallationStatsController {
  constructor(private readonly stats: InstallationStatsService) {}

  @ApiOperation({
    description:
      'Statistics of the installation for the last 7, 30 or 90 days, over ' +
      'the agents the caller reaches, with the period before it for ' +
      'comparison: tokens in and out, model calls, estimated cost and ' +
      'distinct people in conversations; spend by day and model; agents by ' +
      'cost with a projection for 30 days; incidents and requests refused ' +
      'by limits; conversations and ratings per agent; conversations by ' +
      'channel. Counts, names of agents and models, and times only: no ' +
      "person's name, identity, question or message. Cost is computed from " +
      "the product's price list, not from a provider's invoice; a model " +
      'without a price is named and left out of it. Days are UTC days for ' +
      'every caller. Owner and Admin only.',
    operationId: 'getInstallationStats',
  })
  @ApiOkResponse({ type: InstallationStatsDto })
  @ApiBadRequestResponse({ description: '`period` is not 7, 30 or 90.' })
  @ApiUnauthorizedResponse({ description: 'No valid token.' })
  @ApiForbiddenResponse({ description: 'The caller is a User.' })
  @Get()
  async get(
    @Query() query: InstallationStatsQueryDto,
    @Req() req: Request,
  ): Promise<InstallationStatsDto> {
    // Nothing but `period` is read from the query, here or below.
    return this.stats.forCaller(accessCallerOf(req), {
      period: query.period ?? DEFAULT_PERIOD,
    });
  }
}
