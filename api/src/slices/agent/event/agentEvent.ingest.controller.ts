import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiKeyGuard, Scopes, ScopesGuard } from '#/user/auth/guards';
import {
  ApiKeyScopeTypes,
  IApiKeyData,
} from '#/user/apiKey/domain/apiKey.types';
import { AgentEventService, TooManyEventsException } from './domain';
import { AgentEventAcceptedDto, PostAgentEventDto } from './dtos';

/**
 * The one route an outside sender uses (CLEAN-139). Authorised by an API key
 * with the `events:write` scope — a key that can do this and nothing else —
 * never by a console session. Kept apart from the console's controller so
 * the two kinds of caller can never end up behind the same guard by accident.
 *
 * The sender's guide is docs/operations/agent-events.md.
 */
@ApiTags('agent-events')
@Controller('agent-events')
export class AgentEventIngestController {
  private readonly logger = new Logger(AgentEventIngestController.name);

  constructor(private service: AgentEventService) {}

  @Post()
  @UseGuards(ApiKeyGuard, ScopesGuard)
  @Scopes(ApiKeyScopeTypes.EventsWrite)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Report an agent event. Auth: API key with the events:write scope. Any 2xx means Ranch has it — do not retry. The event is stored and may notify the team; it never changes the agent’s status.',
    operationId: 'postAgentEvent',
  })
  @ApiCreatedResponse({ type: AgentEventAcceptedDto })
  @ApiOkResponse({
    type: AgentEventAcceptedDto,
    description: 'Ranch already had this event (`duplicate: true`).',
  })
  @ApiTooManyRequestsResponse({
    description:
      'More than 60 events in a minute from this key. `Retry-After` says how many seconds to wait.',
  })
  async post(
    @Req() req: Request & { apiKey: IApiKeyData },
    @Body() dto: PostAgentEventDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AgentEventAcceptedDto> {
    try {
      const { event, duplicate } = await this.service.acceptExternal(
        req.apiKey,
        dto,
      );
      // A retry of an event we already hold is a success for the sender,
      // but nothing was created.
      if (duplicate) res.status(HttpStatus.OK);
      return {
        id: event.id,
        outcome: event.outcome,
        incidentId: event.incidentId,
        duplicate,
      };
    } catch (err) {
      if (err instanceof TooManyEventsException) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds));
      }
      if (err instanceof HttpException) throw err;
      // Anything else is ours — a database error, a bug. The caller is a
      // machine outside the product holding one narrow key: it gets a plain
      // "try again", and the detail (which can name tables and columns) goes
      // to the log, not over the wire. The global interceptor would have put
      // the error's own message in the answer.
      this.logger.error(
        `Could not record an event from key ${req.apiKey?.id}: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
      throw new InternalServerErrorException(
        'Could not record the event — try again',
      );
    }
  }
}
