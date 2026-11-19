import {
  appGlobalGuards,
  appRoutes,
  type IRouteRow,
} from '#/user/auth/guards/__fixtures__/routeTable';
import { MANAGES_AGENT_METADATA_KEY } from '#/agent/agent/guards/agentManage.guard';
import {
  AGENT_SCOPED_METADATA_KEY,
  type IAgentScope,
} from './agentScoped.decorator';

jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: class {
    loadFromDefault() {}
    loadFromCluster() {}
    makeApiClient() {
      return {};
    }
  },
  CoreV1Api: class {},
  CustomObjectsApi: class {},
  Log: class {},
  Watch: class {},
}));

/**
 * Every route that names an agent asks the access lists (CLEAN-231), pinned.
 *
 * A route names an agent when its path has `:agentId`, or sits under
 * `/agents/:id`. Each such route must carry one of two markers, read by a
 * global guard each:
 *
 *  - `@ManagesAgent`: the manage rule, which includes reach (canManage);
 *  - `@AgentScoped`: reach alone, for the reads that are not management;
 *
 * or stand on the exemption list below with its reason. A route added later
 * with neither fails here, which is what keeps "a hidden agent is hidden on
 * every route" true after this change (FR-007, SC-002). The contract is
 * specs/032-agent-user-access/contracts/enforcement.md.
 *
 * Routes that name an agent in the query or the body, list across agents, or
 * are addressed by a child id (a chat, an evaluation) cannot be found from
 * the path. The ones that carry `@AgentScoped` are pinned in the second
 * list; the handlers that filter or assert are covered by their own specs
 * and by e2e/http.mjs.
 */

/** Why a route that names an agent carries neither marker. */
const EXEMPT: Record<string, string> = {
  // Asks the manage rule in the handler: an agent's runtime reads its own
  // list here, and both guards read an agent's token as nobody.
  'GET /agents/:id/mcps':
    'handler: canManage for a person, own id for an agent runtime',

  // Public or share-token surfaces: not a person's account (FR-011).
  'GET /agents/:agentId/files/raw': 'public: a signed link is its credential',
  'GET /a2a/agents/:agentId/.well-known/agent-card.json':
    'agent to agent, peer guards',
  'POST /a2a/agents/:agentId': 'agent to agent, peer guards',
  'POST /agents/:agentId/usage': 'agent runtime, BridleApiKeyGuard',

  // The chat surface resolves its own identity per route. A console person
  // is asked the lists inside that resolution (ConsoleReachService), a share
  // visitor, an embed token and an anonymous visitor are not.
  'POST /api/agent/:agentId/message': 'bridle: resolveRequester',
  'POST /api/agent/:agentId/message/sync': 'bridle: resolveRequester',
  'POST /api/agent/:agentId/attachment': 'bridle: BridleChatAuthGuard',
  'GET /api/agent/:agentId/attachment/:attachmentId':
    'bridle: BridleChatAuthGuard',
  'GET /api/agent/:agentId/message/:messageId/source/:n/content':
    'bridle: BridleChatAuthGuard',
  'PUT /api/agent/:agentId/message/:messageId/source/:n/rating':
    'bridle: BridleChatAuthGuard',
  'DELETE /api/agent/:agentId/message/:messageId/source/:n/rating':
    'bridle: BridleChatAuthGuard',
  'GET /api/agent/:agentId/health': 'bridle: refuseHiddenAgent in the handler',
  'GET /api/agent/:agentId/transcript': 'bridle: requireChannelAccess',
  'DELETE /api/agent/:agentId/transcript': 'bridle: requireChannelAccess',
  'POST /api/agent/:agentId/transcript/archive': 'bridle: requireChannelAccess',
};

/** Every route that carries `@AgentScoped`, with where it reads the agent. */
const SCOPED: Record<string, string> = {
  // The agent itself, as a reader.
  'GET /agents/:id': 'id',
  'GET /agents/:id/tools': 'id',
  // Owner only; the Owner is never restricted, the marker is for the day
  // the role changes.
  'POST /agents/:id/promote-admin': 'id',
  'DELETE /agents/:id/promote-admin': 'id',
  // Personal pins.
  'PUT /agents/:id/pin': 'id',
  'DELETE /agents/:id/pin': 'id',
  // Limits: the reads. The write is a management route.
  'GET /agents/:agentId/limits': 'agentId',
  'GET /agents/:agentId/limits/enabled': 'agentId',
  'GET /agents/:agentId/load': 'agentId',
  // Sharing an agent takes reaching it.
  'GET /agents/:agentId/share-link': 'agentId',
  'POST /agents/:agentId/share-link': 'agentId',
  'POST /agents/:agentId/share-link/regenerate': 'agentId',
  'DELETE /agents/:agentId/share-link': 'agentId',
  // Usage of one agent.
  'GET /agents/:agentId/usage': 'agentId',
  // Lists that take an optional agent filter; the handler filters the rest.
  'GET /agent-events': 'query.agentId',
  'GET /agent-incidents': 'query.agentId',
  'GET /chats': 'query.agentId',
  'GET /paddock-evaluations': 'query.agentId',
  'GET /paddock-scenarios': 'query.agentId',
  // The agent in the body.
  'POST /chats/sync': 'body.agentId',
  'POST /me/chats/sync': 'body.agentId',
  'POST /paddock-evaluations': 'body.agentId',
  'POST /paddock-scenarios': 'body.agentId',
  'POST /paddock-scenarios/generate': 'body.agentId',
  'POST /browser/extension/token': 'body.agentId',
};

const namesAnAgent = (row: IRouteRow): boolean => {
  const path = row.route.slice(row.route.indexOf(' ') + 1);
  return (
    path.includes(':agentId') ||
    path === '/agents/:id' ||
    path.startsWith('/agents/:id/')
  );
};

const scopeOf = (row: IRouteRow): IAgentScope | undefined =>
  row.metadata<IAgentScope>(AGENT_SCOPED_METADATA_KEY);

const manages = (row: IRouteRow): boolean =>
  row.metadata<string>(MANAGES_AGENT_METADATA_KEY) !== undefined;

describe('routes that name an agent', () => {
  it('each asks the lists: @ManagesAgent, @AgentScoped, or a stated exemption', () => {
    const unmarked = appRoutes()
      .filter(namesAnAgent)
      // A marker on a @Public() route does nothing (both guards skip it),
      // so a public route is unmarked whatever it carries.
      .filter((row) => row.isPublic || (!manages(row) && !scopeOf(row)))
      .map((row) => row.route)
      .sort();
    // Both directions: a new unmarked route is a hole, and an exemption
    // whose route is gone or now marked is a reason nobody reads any more.
    expect(unmarked).toEqual(Object.keys(EXEMPT).sort());
  });

  it('every exemption states its reason', () => {
    for (const [route, reason] of Object.entries(EXEMPT)) {
      expect([route, reason.trim().length > 10]).toEqual([route, true]);
    }
  });

  it('the routes marked @AgentScoped match the reviewed list, each with its source', () => {
    const actual = Object.fromEntries(
      appRoutes()
        .filter((row) => !row.isPublic && scopeOf(row) !== undefined)
        .map((row) => [row.route, scopeOf(row)?.source]),
    );
    expect(actual).toEqual(SCOPED);
  });

  it('a param source is a parameter of the route’s own path', () => {
    for (const row of appRoutes()) {
      const source = scopeOf(row)?.source;
      if (source !== 'id' && source !== 'agentId') continue;
      expect([row.route, row.route.includes(`/:${source}`)]).toEqual([
        row.route,
        true,
      ]);
    }
  });

  it('no route carries both markers: the manage rule already includes reach', () => {
    const both = appRoutes()
      .filter((row) => manages(row) && scopeOf(row) !== undefined)
      .map((row) => row.route);
    expect(both).toEqual([]);
  });

  it('the guard that reads the marker is registered globally, after the role guard', () => {
    const guards = appGlobalGuards();
    expect(guards).toContain('AgentAccessGuard');
    expect(guards.indexOf('AgentAccessGuard')).toBeGreaterThan(
      guards.indexOf('RolesGuard'),
    );
  });
});
