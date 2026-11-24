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
 * The routes a plain User may call (CLEAN-232), pinned.
 *
 * RolesGuard is global and a route with no `@Roles` asks for Admin, so a
 * route is open to a User only where a controller says `@Roles(User)`. That
 * makes this list the whole surface of the user console's account type, the
 * way publicRoutes.spec.ts is the whole anonymous surface.
 *
 * Before the guard went global, 136 of 252 routes had no role and let any
 * valid token through: a User could read and write agent files and secrets,
 * templates, skills, knowledge bases, model credentials and settings, and
 * nothing failed.
 *
 * Adding a route here is a deliberate act: say in the PR which screen of the
 * user console (`app/`) calls it and why a User needs it, and check that the
 * handler shows a User only what is theirs. Removing one is a screen that
 * has just started getting 403s. Contract:
 * specs/032-agent-user-access/contracts/acting-party.md, section 6.
 */
const EXPECTED_USER_ROUTES = [
  // Their own session.
  'GET /auth/me',
  // The agents they reach; CLEAN-231 narrows the list per account.
  'GET /agents',
  'GET /agents/status',
  'GET /agents/:id',
  // The assistant, for a User it is switched on for (CLEAN-240): reach
  // decides, and the view is a reader's.
  'GET /agents/admin/current',
  // What the assistant offers the person asking: their own level and
  // counts per area, nothing about anybody else (CLEAN-240).
  'GET /me/assistant-access',
  // The chat's limit notice: one boolean, no numbers.
  'GET /agents/:agentId/limits/enabled',
  // Their own pins, on agents they reach (CLEAN-231). Called by the agent
  // rail and the agent sheet of the user console; changes nothing about the
  // agent and nothing for anybody else.
  'PUT /agents/:id/pin',
  'DELETE /agents/:id/pin',
  // Sharing an agent they reach. The service decides whose link it is.
  'GET /agents/:agentId/share-link',
  'POST /agents/:agentId/share-link',
  'POST /agents/:agentId/share-link/regenerate',
  'DELETE /agents/:agentId/share-link',
  // Their own conversations; every id is ownership-checked by the handler.
  'GET /me/chats',
  'GET /me/chats/:id',
  'GET /me/chats/:id/messages',
  'POST /me/chats/sync',
  'POST /me/chats/:id/feedback',
  'DELETE /me/chats/:id/feedback/:messageId',
  'GET /me/chats/:id/feedback',
  'GET /me/chats/:id/export',
  // The MCP endpoints, open to every authenticated bearer (@AnyBearer in
  // app.module.ts). What a User may list and call there is decided per tool,
  // by its audience; toolAudience.spec.ts pins that.
  'POST /mcp/mcp',
  'GET /mcp/mcp',
  'DELETE /mcp/mcp',
  'GET /mcp/sse',
  'POST /mcp/messages',
  // The Ranch Cookies extension (CLEAN-243), signed in through the user
  // console's session. The catalogue is the static list of services. The
  // browser token is for an agent the caller reaches (@AgentScoped), and the
  // import files the cookies under the caller's chat identity. The
  // integration token stays Admin: the runtime resolves an integration
  // profile across every account.
  'GET /integrations/catalogue',
  'POST /browser/extension/token',
].sort();

describe('routes a User may call', () => {
  it('matches the reviewed list exactly', () => {
    const actual = appRoutes()
      .filter((row) => admits(row, UserRoleTypes.User))
      .map((row) => row.route)
      .sort();
    // Both directions matter: an added route is a hole, a removed one is a
    // screen of the user console that now answers 403.
    expect(actual).toEqual(EXPECTED_USER_ROUTES);
  });

  it('finds the application’s routes at all, so a bad import cannot pass vacuously', () => {
    expect(appRoutes().length).toBeGreaterThan(200);
  });
});
