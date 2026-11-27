import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolAudience, ToolTopics } from '#mcp';
import { clientIdOfAccount } from '#/bridle/domain/chatIdentity';
import {
  callerParty,
  err,
  ok,
  requirePerson,
  type ToolResult,
} from '#/mcp/tooling';
import { DEFAULT_PERIOD, PersonalStatsService, isPeriod } from './domain';

/**
 * The Statistics tab from the chat (CLEAN-258; spec 038, contracts/api.md
 * "Agent tools"): what `GET /me/stats` answers, from the same service.
 *
 * Audience `person`, as the route is every signed-in account's
 * (`@Roles(User)`). The statistics are those of the person the call is made
 * for, taken from `requirePerson`: the tool has no argument that names a
 * person, because an id the model writes proves nothing (docs/agent-tools.md).
 * The Ranch admin agent's token carries Owner; it decides nothing here, and
 * the agent acting for itself, a guest and a colleague's question are refused.
 *
 * Which agents are counted is asked of the access lists for that same
 * person (`callerParty`), inside the service, so an agent they do not reach
 * is absent from every number and every list, as in the console.
 */
@ToolAudience('person')
@Injectable()
export class StatsTool {
  constructor(private readonly personal: PersonalStatsService) {}

  @Tool({
    name: 'get_my_stats',
    topic: ToolTopics.ChatsUsage,
    effect: 'read',
    title: 'Your statistics',
    template: 'How many conversations did I have this month?',
    description:
      'The statistics of the person asking, for their own conversations ' +
      'with the agents of this Ranch over the last 7, 30 or 90 days ' +
      '(`period`, default 30), as their Statistics tab shows them. Nobody ' +
      "else's can be asked for: the tool takes no person. Returns `board` " +
      '(conversations they wrote in and their own messages, each with ' +
      '`previous` for the period before; agents that answered out of the ' +
      'agents they reach), `activity` (conversations per day for the last ' +
      '91 days, by weekday within the period, and the number of active ' +
      'days), `agents` (who they talked to, by messages, with the model ' +
      'and the last contact), `help` (conversations that got answers with ' +
      'cited sources and the most cited sources, hand-overs to other ' +
      'agents, the ratings they gave) and `models` (which models answered; ' +
      '`fallback` true means some days had no usage record and went to the ' +
      "agent's current model). Counts, names and times only: nothing that " +
      'was written. Agents the person cannot use are left out everywhere. ' +
      'Days are cut in `timeZone`, an IANA name such as Europe/Kyiv; pass ' +
      "the person's zone when you know it, otherwise days are UTC days, " +
      'and `timeZone` in the result says which was used. A `notes` entry ' +
      'means that figure has only been counted since `completeSince`: say ' +
      'so instead of presenting it as the whole period.',
    parameters: z.object({
      period: z
        .union([z.literal(7), z.literal(30), z.literal(90)])
        .optional()
        .describe('Days in the period: 7, 30 or 90. Default 30.'),
      timeZone: z
        .string()
        .optional()
        .describe(
          "The person's IANA time zone, e.g. Europe/Kyiv. Default UTC; an " +
            'unknown name is read as UTC.',
        ),
    }),
  })
  async getMyStats(
    args: { period?: unknown; timeZone?: unknown },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    const person = requirePerson(httpRequest);

    // The route has class-validator in front of it. A tool's arguments are
    // not checked against its schema before the call, so what the model
    // wrote is checked here, with the same three values. Absent or null is
    // "not given", which is the default.
    const period = args.period ?? DEFAULT_PERIOD;
    if (!isPeriod(period)) {
      return err(
        '`period` is the number of days: 7, 30 or 90. Call get_my_stats ' +
          'again with one of them, or with none for 30.',
      );
    }

    return ok(
      await this.personal.forPerson(
        {
          userId: person.userId,
          // What that person's own console token is in the chat: `admin`
          // for the Owner, their account id otherwise. From the role the
          // party was proven with, never from the agent's token.
          clientId: clientIdOfAccount({ id: person.userId, role: person.role }),
          caller: callerParty(httpRequest),
        },
        { period, timeZone: args.timeZone },
      ),
    );
  }
}
