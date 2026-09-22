/**
 * FR-004 (CLEAN-109): no tool result carries a secret. Every tool that takes
 * or lists a credential is called with a sentinel in every secret-shaped
 * position — as an argument AND as a field of every row the mocked gateways
 * hand back — and the sentinel must not come out in the result text. The
 * single exception is create_api_key, which returns the plaintext key once
 * (research R6) and says so.
 *
 * The gateways are proxies that answer any method with a row (or a list of
 * rows) full of secrets, so a tool that forgets to strip cannot pass by
 * happening to call a method the harness did not anticipate.
 */
import type { Request } from 'express';
import { UserRoleTypes } from '#/user/user/domain';
import { LlmTool } from '#/llm/llm.tool';
import { McpServerTool } from '#/mcpServer/mcpServer.tool';
import { SecretTool } from '#/agent/secret/secret.tool';
import { UserTool } from '#/user/user/user.tool';
import { IntegrationTool } from '#/integration/integration.tool';
import { ApiKeyTool, KEY_SHOWN_ONCE } from '#/user/apiKey/apiKey.tool';
import { RancherTool } from '#/rancher/rancher.tool';

const SENTINEL = 'SENTINEL-SECRET-7f3a';

const row = () => ({
  id: 'row-1',
  agentId: 'agent-1',
  name: 'Row',
  title: 'Row',
  email: 'row@example.com',
  provider: 'anthropic',
  model: 'claude',
  url: 'https://example.com/mcp',
  transport: 'streamableHttp',
  authType: 'bearer',
  status: 'active',
  role: 'user',
  enabled: true,
  builtIn: false,
  templateIds: [],
  scopes: [],
  group: 'integrations',
  valueType: 'string',
  // every secret-shaped field the product has
  apiKey: SENTINEL,
  authValue: SENTINEL,
  oauthClientId: SENTINEL,
  password: SENTINEL,
  passwordHash: SENTINEL,
  secret: SENTINEL,
  token: SENTINEL,
  cookies: SENTINEL,
  keyHash: SENTINEL,
  createdAt: new Date('2026-09-22T00:00:00Z'),
  updatedAt: new Date('2026-09-22T00:00:00Z'),
});

const LIST_LIKE =
  /^(findAll|findMany|list|findRecent|findByGroup|findDependent|findByTemplate|findExisting|findForAgent|getAll)/;

/** A gateway that answers anything with secret-laden rows. */
function leakyGateway(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, jest.Mock> = {};
  return new Proxy(overrides, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      if (!calls[prop]) {
        calls[prop] = jest.fn(async () =>
          LIST_LIKE.test(prop) ? [row(), row()] : row(),
        );
      }
      return calls[prop];
    },
  });
}

const request = (roles: UserRoleTypes[]): Request =>
  ({ user: { sub: 'agent:admin', email: '', roles } }) as unknown as Request;
const operator = () => request([UserRoleTypes.Owner]);

/** Every plausible argument name, secrets everywhere they could go. */
const args = {
  id: 'row-1',
  agentId: 'agent-1',
  userId: 'agent:admin',
  serverId: 'row-1',
  name: 'Row',
  key: 'API_KEY',
  value: SENTINEL,
  apiKey: SENTINEL,
  authValue: SENTINEL,
  password: SENTINEL,
  secret: SENTINEL,
  token: SENTINEL,
  store: { API_KEY: SENTINEL },
  provider: 'anthropic',
  model: 'claude',
  url: 'https://example.com/mcp',
  transport: 'streamableHttp' as const,
  authType: 'bearer' as const,
  email: 'row@example.com',
  role: 'user',
  service: 'github',
  accountKey: 'main',
  label: 'Main',
  confirm: true,
};

type Result = { content: { text: string }[]; isError?: boolean };
const textOf = (r: Result) => r.content.map((c) => c.text).join('\n');

/** The JSON paths at which the sentinel sits — the failure message names them. */
function leakPaths(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text.includes(SENTINEL) ? ['<text>'] : [];
  }
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (v === SENTINEL) out.push(path || '<root>');
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v))
        walk(x, path ? `${path}.${k}` : k);
    } else if (typeof v === 'string' && v.includes(SENTINEL))
      out.push(`${path}(substring)`);
  };
  walk(parsed, '');
  return out;
}

interface Case {
  name: string;
  run: () => Promise<Result>;
}

function cases(): Case[] {
  const llm = new LlmTool(
    leakyGateway() as never,
    leakyGateway({
      check: jest.fn(async () => ({ ok: false, error: `bad key ${SENTINEL}` })),
    }) as never,
    { get: () => leakyGateway() } as never,
  );
  const mcp = new McpServerTool(leakyGateway() as never);
  const secret = new SecretTool(
    leakyGateway() as never,
    leakyGateway({
      list: jest.fn(async () => [{ name: 'API_KEY', value: SENTINEL }]),
      set: jest.fn(async () => undefined),
      replaceAll: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
    }) as never,
  );
  const user = new UserTool(leakyGateway() as never);
  const integration = new IntegrationTool(leakyGateway() as never);
  const apiKey = new ApiKeyTool(
    leakyGateway() as never,
    leakyGateway() as never,
  );
  const rancher = new RancherTool(
    leakyGateway() as never,
    leakyGateway() as never,
    leakyGateway() as never,
    leakyGateway() as never,
    leakyGateway() as never,
    leakyGateway() as never,
    leakyGateway({
      findAll: jest.fn(async () => [
        {
          group: 'integrations',
          name: 'bridle_api_key',
          value: SENTINEL,
          valueType: 'string',
        },
        {
          group: 'integrations',
          name: 'ranch_api_url',
          value: 'https://api',
          valueType: 'string',
        },
      ]),
      findByGroup: jest.fn(async () => [
        {
          group: 'integrations',
          name: 'bridle_api_key',
          value: SENTINEL,
          valueType: 'string',
        },
      ]),
    }) as never,
    leakyGateway() as never,
    leakyGateway() as never,
    leakyGateway() as never,
  );

  const call = (fn: (...a: never[]) => Promise<unknown>) => () =>
    fn(args as never, null as never, operator() as never) as Promise<Result>;

  return [
    { name: 'get_llm', run: call(llm.getLlm.bind(llm)) },
    { name: 'create_llm', run: call(llm.createLlm.bind(llm)) },
    { name: 'update_llm', run: call(llm.updateLlm.bind(llm)) },
    { name: 'health_check_llm', run: call(llm.healthCheckLlm.bind(llm)) },
    { name: 'llm_usage', run: call(llm.llmUsage.bind(llm)) },
    { name: 'list_llms', run: call(rancher.listLlms.bind(rancher)) },
    { name: 'list_mcp_servers', run: call(mcp.listMcpServers.bind(mcp)) },
    { name: 'get_mcp_server', run: call(mcp.getMcpServer.bind(mcp)) },
    { name: 'register_mcp_server', run: call(mcp.registerMcpServer.bind(mcp)) },
    { name: 'update_mcp_server', run: call(mcp.updateMcpServer.bind(mcp)) },
    {
      name: 'list_agent_secrets',
      run: call(secret.listAgentSecrets.bind(secret)),
    },
    { name: 'set_agent_secret', run: call(secret.setAgentSecret.bind(secret)) },
    {
      name: 'replace_agent_secrets',
      run: call(secret.replaceAgentSecrets.bind(secret)),
    },
    { name: 'list_users', run: call(user.listUsers.bind(user)) },
    { name: 'get_user', run: call(user.getUser.bind(user)) },
    { name: 'create_user', run: call(user.createUser.bind(user)) },
    { name: 'update_user', run: call(user.updateUser.bind(user)) },
    {
      name: 'list_integration_accounts',
      run: call(integration.listIntegrationAccounts.bind(integration)),
    },
    {
      name: 'create_integration_account',
      run: call(integration.createIntegrationAccount.bind(integration)),
    },
    { name: 'list_api_keys', run: call(apiKey.listApiKeys.bind(apiKey)) },
    { name: 'list_settings', run: call(rancher.listSettings.bind(rancher)) },
  ];
}

describe('tool results never carry a secret (FR-004)', () => {
  for (const c of cases()) {
    it(`${c.name} keeps the sentinel out of its result`, async () => {
      let result: Result;
      try {
        result = await c.run();
      } catch (e) {
        // A refusal thrown as an exception carries no row, so it cannot leak;
        // but a thrown error message must not carry the sentinel either.
        expect(String((e as Error).message)).not.toContain(SENTINEL);
        return;
      }
      expect(leakPaths(textOf(result))).toEqual([]);
    });
  }

  it('create_api_key is the one tool that returns a key, once, and says so', async () => {
    const apiKey = new ApiKeyTool(
      leakyGateway() as never,
      leakyGateway({
        create: jest.fn(async () => ({
          apiKey: {
            id: 'k-1',
            name: 'ci',
            prefix: 'rk_ab',
            scopes: [],
            keyHash: SENTINEL,
            createdBy: 'agent:admin',
            createdAt: new Date('2026-09-22T00:00:00Z'),
            lastUsedAt: null,
            expiresAt: null,
          },
          key: 'rk_ab_PLAINTEXT_ONCE',
        })),
      }) as never,
    );
    const text = textOf(
      (await apiKey.createApiKey(
        { name: 'ci', scopes: [] } as never,
        null as never,
        operator() as never,
      )) as Result,
    );
    expect(text).toContain('rk_ab_PLAINTEXT_ONCE');
    expect(text).toContain(KEY_SHOWN_ONCE);
  });
});
