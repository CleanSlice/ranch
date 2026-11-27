import type { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import type { IDelegationGateway } from '#/agent/peer/domain/delegation.gateway';
import type {
  IDelegationAgentScope,
  IDelegationCounts,
} from '#/agent/peer/domain/peer.types';
import type { IChatGateway } from '#/chat/domain/chat.gateway';
import type { IChatSessionRef } from '#/chat/domain/chat.types';
import type { IChatActivityGateway } from '#/chat/domain/chatActivity.gateway';
import type { ChatSourceService } from '#/chat/domain/chatSource.service';
import type { ICitedForClient } from '#/chat/domain/chatSource.types';
import type { ILlmGateway } from '#/llm/domain/llm.gateway';
import type { IUsageGateway } from '#/usage/domain/usage.gateway';
import type { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { openAccess } from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import type { IStatFigureData } from '../figure.types';
import { FigureRegistry } from '../figureRegistry';
import {
  activityFigure,
  citationsFigure,
  handoversFigure,
  ratingsFigure,
} from '../figures';
import { PersonalStatsService } from '../personalStats.service';
import type { IStatFigureGateway } from '../statFigure.gateway';

/**
 * For specs only: everything `GET /me/stats` reads, in memory (CLEAN-258).
 *
 * Each stand-in answers the one read the real slice answers, with the
 * conditions the real query carries: the person, the channel, the range
 * with its ends, and the agents of the scope. None of them is more
 * forgiving than the database. A column that can be NULL there (a rating's
 * author, a hand-over's client) equals nothing here either, and a read that
 * is given no scope returns every agent, exactly as the query would. That
 * is the point of having them: a service that forgot to pass the person or
 * the scope gets other people's rows back, and its spec fails.
 */

type Scope = { in?: string[]; notIn?: string[] } | undefined;

const inScope = (agentId: string, scope: Scope) =>
  (scope?.in === undefined || scope.in.includes(agentId)) &&
  (scope?.notIn === undefined || !scope.notIn.includes(agentId));

const within = (at: Date, from: Date, to: Date) =>
  at.getTime() >= from.getTime() && at.getTime() <= to.getTime();

export interface IWorldAgent {
  id: string;
  name: string;
  /** The model the agent runs now; null for an agent with no credential. */
  model: string | null;
}

/** A `ChatActivityHour` row, with the conversation's own columns. */
export interface IWorldHour {
  sessionId: string;
  agentId: string;
  externalUserId: string;
  /** `bridle` unless said. */
  channel?: string;
  /** Start of the hour, ISO. */
  hour: string;
  userMessages: number;
  agentMessages: number;
}

export interface IWorldRating {
  /** Null: a rating nobody is recorded as the author of. */
  authorId: string | null;
  sessionId: string;
  rating: 1 | -1;
  at: string;
}

/** One answer's citation of one source. */
export interface IWorldCitation {
  clientId: string;
  agentId: string;
  messageId: string;
  /** A knowledge base's name; null for a web page. */
  base: string | null;
  at: string;
}

export interface IWorldHandover {
  /** Null: made in a turn with no chat client. */
  clientId: string | null;
  agentId: string;
  peerAgentId: string | null;
  peerName: string;
  status: 'waiting' | 'answered' | 'failed' | 'rejected';
  at: string;
}

export interface IWorldUsage {
  agentId: string;
  /** The UTC day, `YYYY-MM-DD`. */
  day: string;
  model: string;
  calls: number;
}

export interface IStatsWorld {
  agents: IWorldAgent[];
  hours: IWorldHour[];
  /** Last message time per conversation, ISO; a conversation not named here
   *  has the end of its last hour row. */
  lastMessageAt: Record<string, string>;
  ratings: IWorldRating[];
  citations: IWorldCitation[];
  handovers: IWorldHandover[];
  usage: IWorldUsage[];
  /** `StatFigure` rows, key to ISO date. Only a recorded figure has one
   *  (`activity` here); a row named for a figure read in place stands for a
   *  stale one that boot has not removed yet (CLEAN-262). */
  completeSince: Record<string, string>;
}

const EMPTY: IStatsWorld = {
  agents: [],
  hours: [],
  lastMessageAt: {},
  ratings: [],
  citations: [],
  handovers: [],
  usage: [],
  completeSince: {},
};

const HOUR_MS = 60 * 60 * 1000;

/**
 * A read that remembers what it was asked, so a spec can check the person,
 * the range and the scope a query went out with. Not `jest.fn`: this file
 * is compiled with the application, where jest does not exist.
 */
function recorded<A extends unknown[], R>(read: (...args: A) => R) {
  const calls: A[] = [];
  const wrapped = (...args: A): R => {
    calls.push(args);
    return read(...args);
  };
  return Object.assign(wrapped, { calls });
}

export function statsHarness(
  seed: Partial<IStatsWorld> = {},
  access: AgentAccessService = openAccess(),
) {
  const world: IStatsWorld = { ...EMPTY, ...seed };

  /** A conversation's agent: every hour row of one names the same. */
  const agentOfSession = (sessionId: string) =>
    world.hours.find((h) => h.sessionId === sessionId)?.agentId;

  const activity = {
    findHoursForPerson: recorded(
      (
        externalUserId: string,
        channel: string,
        from: Date,
        to: Date,
        agentScope?: Scope,
      ) =>
        Promise.resolve(
          world.hours
            .filter(
              (h) =>
                h.externalUserId === externalUserId &&
                (h.channel ?? 'bridle') === channel &&
                within(new Date(h.hour), from, to) &&
                inScope(h.agentId, agentScope),
            )
            .map((h) => ({
              sessionId: h.sessionId,
              agentId: h.agentId,
              hour: new Date(h.hour),
              userMessages: h.userMessages,
              agentMessages: h.agentMessages,
            }))
            .sort((a, b) => a.hour.getTime() - b.hour.getTime()),
        ),
    ),
  };

  const chats = {
    findSessionsByIds: recorded(
      (ids: readonly string[], agentScope?: Scope) => {
        const found: IChatSessionRef[] = [];
        for (const id of new Set(ids)) {
          const rows = world.hours.filter((h) => h.sessionId === id);
          if (rows.length === 0) continue;
          if (!inScope(rows[0].agentId, agentScope)) continue;
          const lastHour = Math.max(
            ...rows.map((h) => new Date(h.hour).getTime()),
          );
          found.push({
            id,
            agentId: rows[0].agentId,
            lastMessageAt: world.lastMessageAt[id]
              ? new Date(world.lastMessageAt[id])
              : new Date(lastHour + HOUR_MS - 1),
          });
        }
        return Promise.resolve(found);
      },
    ),
    countFeedbackByAuthor: recorded(
      (authorId: string, from: Date, to: Date, agentScope?: Scope) => {
        const counts = { up: 0, down: 0 };
        for (const r of world.ratings) {
          if (r.authorId === null || r.authorId !== authorId) continue;
          if (!within(new Date(r.at), from, to)) continue;
          if (agentScope) {
            const agentId = agentOfSession(r.sessionId);
            if (agentId === undefined || !inScope(agentId, agentScope)) {
              continue;
            }
          }
          if (r.rating > 0) counts.up += 1;
          else counts.down += 1;
        }
        return Promise.resolve(counts);
      },
    ),
  };

  const sources = {
    citedForClient: recorded(
      (
        clientId: string,
        from: Date,
        to: Date,
        agentScope?: Scope,
      ): Promise<ICitedForClient> => {
        const rows = world.citations.filter(
          (c) =>
            c.clientId === clientId &&
            within(new Date(c.at), from, to) &&
            inScope(c.agentId, agentScope),
        );
        const answers = new Map<string, { agentId: string; at: Date }>();
        const counts = new Map<string, number>();
        for (const c of rows) {
          const at = new Date(c.at);
          const seen = answers.get(c.messageId);
          if (!seen || at < seen.at) {
            answers.set(c.messageId, { agentId: c.agentId, at });
          }
          const name = c.base ?? 'web';
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        return Promise.resolve({
          answers: [...answers.values()].sort(
            (a, b) => a.at.getTime() - b.at.getTime(),
          ),
          sources: [...counts]
            .map(([name, citations]) => ({ name, citations }))
            .sort(
              (a, b) =>
                b.citations - a.citations || a.name.localeCompare(b.name),
            ),
        });
      },
    ),
  };

  const delegations = {
    countForClient: recorded(
      (
        clientId: string,
        from: Date,
        to: Date,
        agentScope?: IDelegationAgentScope,
      ): Promise<IDelegationCounts> => {
        const rows = world.handovers.filter(
          (h) =>
            h.clientId !== null &&
            h.clientId === clientId &&
            within(new Date(h.at), from, to) &&
            inScope(h.agentId, agentScope),
        );
        const peers = new Map<
          string,
          { peerAgentId: string | null; name: string; count: number }
        >();
        for (const h of rows) {
          const key = h.peerAgentId ?? `name:${h.peerName}`;
          const peer = peers.get(key) ?? {
            peerAgentId: h.peerAgentId,
            name: h.peerName,
            count: 0,
          };
          peer.count += 1;
          peers.set(key, peer);
        }
        return Promise.resolve({
          total: rows.length,
          answered: rows.filter((h) => h.status === 'answered').length,
          peers: [...peers.values()].sort(
            (a, b) => b.count - a.count || a.name.localeCompare(b.name),
          ),
        });
      },
    ),
  };

  const usage = {
    findRange: recorded((from: Date, to: Date, agentIds?: readonly string[]) =>
      Promise.resolve(
        world.usage
          .filter((u) => {
            const date = new Date(`${u.day}T00:00:00.000Z`).getTime();
            return (
              date >= from.getTime() &&
              date < to.getTime() &&
              (agentIds === undefined || agentIds.includes(u.agentId))
            );
          })
          .map((u) => ({
            id: `${u.agentId}|${u.model}|${u.day}`,
            agentId: u.agentId,
            agentName: null,
            llmCredentialId: null,
            model: u.model,
            date: new Date(`${u.day}T00:00:00.000Z`),
            inputTokens: 0,
            outputTokens: 0,
            callCount: u.calls,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          })),
      ),
    ),
  };

  const credentialOf = (agent: IWorldAgent) =>
    agent.model === null ? null : `llm-of-${agent.id}`;

  const agents = {
    findAll: recorded(() =>
      Promise.resolve(
        world.agents.map((a) => ({
          id: a.id,
          name: a.name,
          llmCredentialId: credentialOf(a),
        })),
      ),
    ),
  };

  const llms = {
    findById: recorded((id: string) => {
      const agent = world.agents.find(
        (a) => a.model !== null && credentialOf(a) === id,
      );
      return Promise.resolve(
        agent
          ? {
              id,
              model: agent.model,
              // What a credential also holds, and what no answer may carry.
              apiKey: 'sk-secret-of-the-installation',
              label: 'credential-label',
            }
          : null,
      );
    }),
  };

  const figureRows: IStatFigureData[] = Object.entries(world.completeSince).map(
    ([key, since]) => ({
      key,
      completeSince: new Date(since),
      updatedAt: new Date(since),
    }),
  );
  const registry = new FigureRegistry({
    findAll: () => Promise.resolve(figureRows),
    createIfAbsent: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  } as IStatFigureGateway);
  registry.register(activityFigure);
  registry.register(ratingsFigure);
  registry.register(citationsFigure);
  registry.register(handoversFigure);

  const service = new PersonalStatsService(
    activity as unknown as IChatActivityGateway,
    chats as unknown as IChatGateway,
    sources as unknown as ChatSourceService,
    delegations as unknown as IDelegationGateway,
    usage as unknown as IUsageGateway,
    agents as unknown as IAgentGateway,
    llms as unknown as ILlmGateway,
    access,
    registry,
  );

  return {
    service,
    world,
    reads: { activity, chats, sources, delegations, usage, agents, llms },
  };
}
