import { UserRoleTypes } from '../../user/domain';
import { admits, appRoutes } from './__fixtures__/routeTable';

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
 * The routes an agent runtime's own token may call (CLEAN-232), pinned.
 *
 * On a route, a bearer whose `sub` is `agent:<id>` is an `Agent` and nothing
 * else, whatever roles the token carries (`heldRoles` in roles.guard.ts).
 * `Agent` matches only a route that names it, so this list is everything an
 * agent's token opens over REST. That includes the Ranch admin agent, whose
 * token carries Owner: it used to open every route, and an administrator can
 * print it with the runtime's `exec` tool.
 *
 * What a runtime calls with this token today is the MCP endpoints and
 * nothing else; its REST calls (usage, browser sessions, integrations, MCP
 * OAuth) authenticate with the shared bridle key and are `@Public()` routes
 * behind BridleApiKeyGuard. `GET /agents/:id/mcps` is kept for runtimes that
 * read their MCP list at boot; the handler lets an agent read only its own.
 *
 * Adding a route here hands it to every agent on the Ranch, each of which
 * runs prompts written by other people. Say in the PR why the bridle key or
 * a tool will not do, and make the handler check that the agent asks about
 * itself. Contract: specs/032-agent-user-access/contracts/acting-party.md,
 * section 6.
 */
const EXPECTED_AGENT_ROUTES = [
  // Self-scoped in the handler: `sub` must be `agent:<id>` of the path.
  'GET /agents/:id/mcps',
  // The MCP endpoints (@AnyBearer in app.module.ts). The token only gets the
  // agent in; every tools/list and tools/call is answered for the party the
  // call is made for.
  'POST /mcp/mcp',
  'GET /mcp/mcp',
  'DELETE /mcp/mcp',
  'GET /mcp/sse',
  'POST /mcp/messages',
].sort();

describe('routes an agent runtime’s token may call', () => {
  it('matches the reviewed list exactly', () => {
    const actual = appRoutes()
      .filter((row) => admits(row, UserRoleTypes.Agent))
      .map((row) => row.route)
      .sort();
    expect(actual).toEqual(EXPECTED_AGENT_ROUTES);
  });

  it('names Agent explicitly on each of them: no route admits an agent by default', () => {
    const byDefault = appRoutes()
      .filter((row) => admits(row, UserRoleTypes.Agent))
      .filter((row) => !row.statedRoles?.includes(UserRoleTypes.Agent))
      .map((row) => row.route);
    expect(byDefault).toEqual([]);
  });

  it('finds the application’s routes at all, so a bad import cannot pass vacuously', () => {
    expect(appRoutes().length).toBeGreaterThan(200);
  });
});
