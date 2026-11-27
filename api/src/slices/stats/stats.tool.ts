import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolAudience, ToolTopics } from '#mcp';
import { clientIdOfAccount } from '#/bridle/domain/chatIdentity';
import {
  ACCESS_SCOPE_NOTE,
  accessScope,
  callerParty,
  err,
  ok,
  ownerOnlyLeftOutField,
  requireOperator,
  requirePerson,
  type ToolResult,
} from '#/mcp/tooling';

/** What the installation's figures leave out of the assistant, as a person reads it. */
const STATS_LEFT_OUT = 'conversations, usage figures and limit refusals';
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
 * What the conversation summaries add (CLEAN-270) follows the same line.
 * `get_my_stats` carries the main questions of the person asking, as their
 * own page does: a question is its person's words and is shown to its owner
 * alone (spec 038, FR-033). `get_installation_stats` carries counts of how
 * conversations ended and no question, topic or name, for the Owner as for
 * anybody. Topics are named in English here: a tool call has no
 * `Accept-Language`, and the agent words its answer in the person's
 * language itself. Both descriptions say what an installation without
 * summaries looks like (`summaries.enabled` false), the ordinary case: the
 * model can only say "not produced" instead of "none" if it was told. For
 * the same reason `get_my_stats` says what an empty `topics` means while
 * the installation has no vocabulary (`summaries.topicsReady` false, the
 * owner's decision of 2026-11-28; CLEAN-278 is where one comes to exist).
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
      "agent's current model). From the summaries of their conversations: " +
      '`summaries` (how many of the period’s conversations have a summary, ' +
      'are `waiting` for one, or are `tooShort` to get one), ' +
      '`board.resolved` (`resolved` out of `summarised`; each agent in ' +
      '`agents` has the same two), `topics` (up to eight, with ' +
      '`conversations`, `resolved`, `open` and their own main questions ' +
      'under each; labels are in English), `outcome` (resolved, open, ' +
      'unknown and notSummarised add up to the conversations; unknown ' +
      'means the summary could not tell and is neither resolved nor open; ' +
      'tone and languages beside them) and `openQuestions` (the newest ' +
      'four left open, each with its `chatId` and agent, and `more` for ' +
      'the rest). When `summaries.enabled` is false this Ranch produces no ' +
      'summaries: those parts are all zero or empty and say nothing. Tell ' +
      'the person that summaries are not produced here, never that ' +
      'nothing was left open or that they talked about nothing. When ' +
      '`summaries.topicsReady` is false, `topics` is empty and no open ' +
      'question has a `topic` because topics are not set up on this Ranch ' +
      'yet: say that, and answer from the rest. Counts, ' +
      'names and times, and of what was written only their own main ' +
      'questions, as the summaries worded them. Agents the person cannot ' +
      'use are left out everywhere. ' +
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
      '`reach.ownerOnly` names agents whose conversations and records ' +
      'only the Owner may read (the Ranch assistant): they are in no ' +
      '`people`, `quality` or `channels` figure of this answer, and in ' +
      'no token, call, cost, projection or refusal figure either; their ' +
      'incidents are listed. `notIncluded` says the same in a sentence: ' +
      'tell the person so, never that the assistant cost nothing. ' +
      ACCESS_SCOPE_NOTE +
      ' Returns `board` ' +
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
      'ratings per agent, `down` out of `rated`; and `open` out of ' +
      '`summarised`: of the conversations that have a summary, the ones ' +
      'left without an answer; give the share together with `summarised`, ' +
      'a share of 3 conversations is not one of 300) and `channels` ' +
      '(conversations from the console, Telegram, Slack, share links and ' +
      'anything else). When `summaries.enabled` is false this Ranch ' +
      'produces no summaries: `open` and `summarised` are 0 because they ' +
      'are not counted. Say that summaries are not produced, never that ' +
      'no conversation was left open. ' +
      "Cost is an estimate from the product's price list, " +
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
    const stats = await this.installation.forCaller(callerParty(httpRequest), {
      period,
    });
    // The two sentences every list over the agents carries (CLEAN-268),
    // beside the structured `reach` the page reads: what was left out
    // because it is the Owner's, and that the caller's lists narrowed the
    // rest. Both are decided by the service; nothing is asked again.
    return ok({
      ...stats,
      ...(stats.reach.ownerOnly.length > 0
        ? ownerOnlyLeftOutField(httpRequest, STATS_LEFT_OUT)
        : {}),
      ...accessScope({ unrestricted: !stats.reach.limited }),
    });
  }
}
