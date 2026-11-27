import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { clientIdFromJwtPayload } from '#/bridle/domain/chatIdentity';
import { topicLanguageOf } from '#/chat/domain/chatTopic';
import { accessCallerOf } from '#/user/agentAccess/guards';
import { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { JwtAuthGuard, Roles } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import { DEFAULT_PERIOD, IStatsViewer, PersonalStatsService } from './domain';
import { MyStatsDto, MyStatsQueryDto } from './dtos';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

const NO_PERSON = 'No authenticated user';

/**
 * A signed-in person's own statistics (CLEAN-258; spec 038, contracts/api.md).
 *
 * Whose they are is read from the token and from nothing else: the route has
 * no path parameter, the query has no field that names a person, and the
 * handler takes none from it (FR-020). Which agents count is asked of the
 * access lists for that same person (FR-022). So there is nothing here that
 * belongs to somebody else and nothing to answer 403 or 404 about: a request
 * can be wrong only in its period, which is a 400. The one refusal in this
 * file is for a token that names no person at all (`viewerOf`).
 */
@ApiTags('stats')
@ApiBearerAuth()
@Controller('me/stats')
@UseGuards(JwtAuthGuard)
// Stated, not left to a default: a route with no @Roles asks for Admin
// (CLEAN-232), and these are every signed-in account's own figures.
@Roles(UserRoleTypes.User)
export class MyStatsController {
  constructor(private readonly stats: PersonalStatsService) {}

  @ApiOperation({
    description:
      "The current user's own statistics for the last 7, 30 or 90 days, " +
      'with the period before it for comparison: conversations they wrote ' +
      'in, their messages, the agents that answered, activity by day for ' +
      'the last 13 weeks and by weekday, the agents they talked to, how ' +
      'agents helped (cited sources, hand-overs to peers, their ratings) ' +
      'and which models answered. Where the installation produces ' +
      'conversation summaries (`summaries.enabled`), also what their ' +
      'conversations were about (`topics`, named in the language of ' +
      '`Accept-Language`; empty until the installation has a vocabulary, ' +
      '`summaries.topicsReady`), how they ended (`outcome`, `board.resolved`) ' +
      'and which were left open (`openQuestions`); where it does not, ' +
      'those parts are empty. Counts, names and times, and of what was ' +
      "written only the caller's own main questions, as the summaries of " +
      'their conversations worded them. Only conversations with agents ' +
      'the caller reaches now are counted. Days are cut in the zone sent ' +
      'as `tz`.',
    operationId: 'getMyStats',
  })
  @ApiOkResponse({ type: MyStatsDto })
  @ApiBadRequestResponse({
    description: '`period` is not 7, 30 or 90.',
  })
  @ApiUnauthorizedResponse({ description: 'No valid token.' })
  @Get()
  async get(
    @Query() query: MyStatsQueryDto,
    @Req() req: AuthedRequest,
  ): Promise<MyStatsDto> {
    // Nothing but `period` and `tz` is read from the query, here or below.
    const header = req.headers?.['accept-language'];
    return this.stats.forPerson(this.viewerOf(req), {
      period: query.period ?? DEFAULT_PERIOD,
      timeZone: query.tz,
      // Topics are named in the console's language (CLEAN-270), which the
      // app console sends with every request. Which of the languages a
      // topic has a label in the header asks for is the chat slice's to
      // say, as on `GET /me/chats`; English when it names none of them.
      language: topicLanguageOf(
        typeof header === 'string' ? header : undefined,
      ),
    });
  }

  /**
   * The caller, under both of their names. The chat identity is whatever the
   * bridle hub gives the same token, by the same function `GET /me/chats`
   * uses (`clientIdFromJwtPayload`): `admin` for the Owner, the token's
   * `sub` for everybody else. Ratings are kept under the `sub` itself, the
   * Owner's included.
   *
   * A token that function reads no identity from is refused. Its `sub` is
   * missing, or is one of the identities the hub keeps for itself (`admin`,
   * `cron`, `heartbeat`, a `peer:` task); taking the bare `sub` instead
   * would read the Owner's conversations for a token that merely names
   * itself `admin`. No signed console token looks like that.
   */
  private viewerOf(req: AuthedRequest): IStatsViewer {
    const userId = req.user?.sub;
    const identity = clientIdFromJwtPayload(
      req.user as unknown as Record<string, unknown>,
    );
    if (!userId || !identity) throw new ForbiddenException(NO_PERSON);
    return {
      userId,
      clientId: identity.clientId,
      caller: accessCallerOf(req),
    };
  }
}
