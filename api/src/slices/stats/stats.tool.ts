import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolAudience, ToolTopics } from '#mcp';
import { clientIdOfAccount } from '#/bridle/domain/chatIdentity';
import {
  callerParty,
  err,
  ok,
  requireOperator,
  requirePerson,
  type ToolResult,
} from '#/mcp/tooling';
import {
  DEFAULT_PERIOD,
  InstallationStatsService,
  PersonalStatsService,
  isPeriod,
} from './domain';

/**
 * The Statistics tab from the chat (CLEAN-258, CLEAN-265; spec 038,
 * contracts/api.md "Agent tools"): what `GET /me/stats` and
 * `GET /stats/installation` answer, each from the service its route calls.
 *
 * The class is `person`, as `me/stats` is every signed-in account's
 * (`@Roles(User)`). The statistics are those of the person the call is made
 * for, taken from `requirePerson`: the tool has no argument that names a
 * person, because an id the model writes proves nothing (docs/agent-tools.md).
 * The Ranch admin agent's token carries Owner; it decides nothing here, and
 * the agent acting for itself, a guest and a colleague's question are refused.
 *
 * `get_installation_stats` is narrower than its class: `admin`, stated on
 * the method, as its route is `@Roles(Owner, Admin)`.
 *
 * The class has no `isListedForRequest`, and should not get one. The
 * catalogue lists each tool by its own audience before it asks the class
 * anything, so a User is never shown the admin tool; a class-wide check for
 * an operator would take `get_my_stats` away from every User with it.
 *
 * Which agents are counted is asked of the access lists for the party the
 * call is made for (`callerParty`), inside each service, so an agent that
 * party does not reach is absent from every number and every list, as in
 * the console. The installation's service asks for the same party who
 * manages the Ranch assistant, and leaves its conversations out for anybody
 * but the Owner (CLEAN-236); the answer names it in `reach.ownerOnly`, and
 * the description tells the agent to pass that on (CLEAN-267).
 */
@ToolAudience('person')
@Injectable()
export class StatsTool {
  constructor(
    private readonly personal: PersonalStatsService,
    private readonly installation: InstallationStatsService,
  ) {}

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

  @ToolAudience('admin')
  @Tool({
    name: 'get_installation_stats',
    topic: ToolTopics.ChatsUsage,
    effect: 'read',
    title: 'Installation statistics',
    template:
      'What did the agents cost in the last 90 days, and which had incidents?',
    description:
      'Statistics of this Ranch over the last 7, 30 or 90 days (`period`, ' +
      'default 30), as the "Whole installation" side of the Statistics tab ' +
      'shows them, for the agents the person asking can use: every figure, ' +
      'totals included, leaves out an agent they cannot, and `reach.limited` ' +
      'true means the answer is a part of the installation. ' +
      '`reach.ownerOnly` names agents whose conversations only the Owner ' +
      'may read: they are in no `people`, `quality` or `channels` figure ' +
      'of this answer, their cost, incidents and refusals are; tell the ' +
      'person so when it is not empty. Returns `board` ' +
      '(tokens in and out; model calls, estimated cost and distinct people ' +
      'in conversations, each with `previous` for the period before), ' +
      '`daily` (tokens by model and estimated cost for each day), `models` ' +
      '(each with `priced`), `agents` by cost (tokens, calls, the model each ' +
      'used most; `removed` true for an agent that no longer exists, listed ' +
      'under the name it had; `partial` true when its cost leaves out a ' +
      'model with no price), `projection30d` (cost for 30 days at the pace ' +
      "of the period's finished days, null while there is none or no model " +
      'with a price ran in them), `health` (incidents opened in the period or still ' +
      'open, newest first, with `incidentsTotal` when the list was cut; ' +
      'requests refused by limits per agent), `quality` (conversations and ' +
      'ratings per agent, `down` out of `rated`) and `channels` ' +
      '(conversations from the console, Telegram, Slack, share links and ' +
      "anything else). Cost is an estimate from the product's price list, " +
      "not a provider's invoice: a model in `board.cost.unpriced`, or an " +
      'agent whose `cost` is null, has no price. Say "no price", never ' +
      'zero. Days are UTC days, the same for everybody. Counts, names of ' +
      'agents and models, and times only: no person is named, and nothing ' +
      'that was written comes back. A `notes` entry means that figure has ' +
      'only been counted since `completeSince`: say so instead of ' +
      'presenting it as the whole period. Needs an administrator.',
    parameters: z.object({
      period: z
        .union([z.literal(7), z.literal(30), z.literal(90)])
        .optional()
        .describe('Days in the period: 7, 30 or 90. Default 30.'),
    }),
  })
  async getInstallationStats(
    args: { period?: unknown },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);

    // As in `get_my_stats`: the arguments are whatever the model wrote.
    const period = args.period ?? DEFAULT_PERIOD;
    if (!isPeriod(period)) {
      return err(
        '`period` is the number of days: 7, 30 or 90. Call ' +
          'get_installation_stats again with one of them, or with none ' +
          'for 30.',
      );
    }

    // The party the call is made for, so an Admin asking through the
    // assistant is limited to their agents exactly as in the console. Not
    // the agent's token: that carries Owner whoever is asking.
    return ok(
      await this.installation.forCaller(callerParty(httpRequest), { period }),
    );
  }
}
