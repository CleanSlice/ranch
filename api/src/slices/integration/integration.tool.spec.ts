import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { IntegrationTool } from './integration.tool';
import type { IntegrationService } from './domain/integration.service';
import type {
  IIntegrationAccountData,
  ILoginInstructionData,
} from './domain/integration.types';
import { UserRoleTypes } from '#/user/user/domain';
import {
  MCP_TOOL_METADATA_KEY,
  ToolTopics,
  toolAudienceOf,
} from '#/mcp/decorators';
import type { ToolMetadata } from '#/mcp/decorators';
import { toolMetadataProblems } from '#/mcp/services/mcp-registry.service';
import { asGuest, asPerson, asTrustedAgent } from '#/mcp/testing';

/**
 * These tools hand an agent the user's integration accounts. Two things
 * matter more than the happy path: that no credential ever comes back
 * through them (the rows are metadata, but a sentinel proves the strip is
 * real), and that disconnecting waits for the person's yes.
 */
const SENTINEL = 'SENTINEL-INTEGRATION';

/**
 * A row as the service would return it, plus every secret-shaped field a
 * future column might add. The tool must drop all of them.
 */
const account = (
  overrides: Partial<IIntegrationAccountData> = {},
): IIntegrationAccountData =>
  ({
    id: 'acc-1',
    userId: 'user-1',
    service: 'instagram',
    accountKey: 'miybot',
    mechanism: 'browser',
    label: 'Main IG',
    status: 'pending',
    createdAt: new Date('2026-09-17T10:00:00.000Z'),
    updatedAt: new Date('2026-09-17T10:00:00.000Z'),
    secret: SENTINEL,
    cookies: [{ name: 'sessionid', value: SENTINEL }],
    token: SENTINEL,
    password: SENTINEL,
    ...overrides,
  }) as IIntegrationAccountData;

const loginInstruction = (): ILoginInstructionData => ({
  accountId: 'acc-1',
  siteUrl: 'https://www.instagram.com/accounts/login/',
  helpUrl: 'https://admin.test/sessions',
  instructions: 'Open Instagram and log in as @miybot.',
});

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

/** A plain agent runtime answering the signed-in person «user-1». */
const agent = () =>
  asPerson(request([UserRoleTypes.Agent]), UserRoleTypes.User, 'user-1');
/** The same runtime with nobody proven behind the call. */
const nobody = () => request([UserRoleTypes.Agent]);

interface Harness {
  tool: IntegrationTool;
  service: {
    listCatalogue: jest.Mock;
    listAccounts: jest.Mock;
    connect: jest.Mock;
    openLogin: jest.Mock;
    getAccount: jest.Mock;
    disconnect: jest.Mock;
  };
}

function harness(): Harness {
  const service = {
    listCatalogue: jest.fn().mockReturnValue([
      {
        service: 'instagram',
        title: 'Instagram',
        description: 'Post and read DMs.',
        iconUrl: '/icons/integrations/instagram.svg',
        mechanism: 'browser',
        loginUrl: 'https://www.instagram.com/accounts/login/',
      },
      {
        service: 'openai',
        title: 'OpenAI',
        description: 'API key.',
        iconUrl: '/icons/integrations/openai.svg',
        mechanism: 'secret',
        secretEnvKey: 'OPENAI_API_KEY',
      },
    ]),
    listAccounts: jest.fn().mockResolvedValue([account()]),
    connect: jest.fn().mockResolvedValue(account()),
    openLogin: jest.fn().mockResolvedValue(loginInstruction()),
    getAccount: jest.fn().mockResolvedValue(account()),
    disconnect: jest.fn().mockResolvedValue(undefined),
  };
  const tool = new IntegrationTool(service as unknown as IntegrationService);
  return { tool, service };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('IntegrationTool — who may use it', () => {
  it('has no listing hook of its own: the person audience decides', () => {
    const { tool } = harness();
    expect(
      (tool as unknown as Record<string, unknown>).isListedForRequest,
    ).toBeUndefined();
    expect(toolAudienceOf(IntegrationTool, undefined)).toBe('person');
  });

  it('refuses every tool when no person is behind the call, and touches nothing (CLEAN-232)', async () => {
    const { tool, service } = harness();
    const callers = [
      nobody,
      () => asGuest(request([UserRoleTypes.Agent])),
      // An agent acting for itself has no accounts of its own to manage,
      // the Ranch admin agent included.
      () => asTrustedAgent(request([UserRoleTypes.Owner])),
    ];

    for (const caller of callers) {
      const calls = [
        () => tool.listIntegrationCatalogue({}, null, caller()),
        () => tool.listIntegrationAccounts({}, null, caller()),
        () =>
          tool.createIntegrationAccount(
            { service: 'instagram', accountKey: 'miybot' },
            null,
            caller(),
          ),
        () => tool.requestIntegrationLogin({ id: 'acc-1' }, null, caller()),
        () =>
          tool.deleteIntegrationAccount(
            { id: 'acc-1', confirm: true },
            null,
            caller(),
          ),
      ];
      for (const call of calls) {
        await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
      }
    }
    for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
  });

  it('takes no user id from the model: an extra userId argument changes nothing', async () => {
    const { tool, service } = harness();
    // What a model that still believes in the old parameter would send.
    const args = { userId: 'user-owner' } as unknown as Record<string, never>;

    await tool.listIntegrationAccounts(args, null, agent());
    await tool.deleteIntegrationAccount(
      { userId: 'user-owner', id: 'acc-1', confirm: true } as never,
      null,
      agent(),
    );

    expect(service.listAccounts).toHaveBeenCalledWith('user-1');
    expect(service.getAccount).toHaveBeenCalledWith('user-1', 'acc-1');
    expect(service.disconnect).toHaveBeenCalledWith('user-1', 'acc-1');
  });

  it('no tool declares a userId parameter any more', () => {
    for (const method of [
      'listIntegrationAccounts',
      'createIntegrationAccount',
      'requestIntegrationLogin',
      'deleteIntegrationAccount',
    ]) {
      const metadata = Reflect.getMetadata(
        MCP_TOOL_METADATA_KEY,
        (IntegrationTool.prototype as unknown as Record<string, object>)[
          method
        ],
      ) as ToolMetadata;
      const shape = (
        metadata.parameters as unknown as { shape: Record<string, unknown> }
      ).shape;
      expect(Object.keys(shape)).not.toContain('userId');
    }
  });
});

describe('IntegrationTool — panel metadata', () => {
  const TOOL_METHODS = [
    'listIntegrationCatalogue',
    'listIntegrationAccounts',
    'createIntegrationAccount',
    'requestIntegrationLogin',
    'deleteIntegrationAccount',
  ] as const;

  const metadataOf = (method: string): Partial<ToolMetadata> =>
    Reflect.getMetadata(
      MCP_TOOL_METADATA_KEY,
      (IntegrationTool.prototype as unknown as Record<string, object>)[method],
    ) as Partial<ToolMetadata>;

  it('passes the registry check the API refuses to boot without', () => {
    const problems = TOOL_METHODS.flatMap((m) =>
      toolMetadataProblems(metadataOf(m)),
    );
    expect(problems).toEqual([]);
  });

  it('exposes exactly the five contract names under the browser topic', () => {
    const names = TOOL_METHODS.map((m) => metadataOf(m).name).sort();
    expect(names).toEqual([
      'create_integration_account',
      'delete_integration_account',
      'list_integration_accounts',
      'list_integration_catalogue',
      'request_integration_login',
    ]);
    for (const m of TOOL_METHODS) {
      expect(metadataOf(m).topic).toBe(ToolTopics.Browser);
    }
    expect(metadataOf('deleteIntegrationAccount').destructive).toBe(true);
  });
});

describe('IntegrationTool — reading', () => {
  it('lists the catalogue with service keys and mechanisms', async () => {
    const { tool, service } = harness();
    const text = textOf(await tool.listIntegrationCatalogue({}, null, agent()));
    expect(service.listCatalogue).toHaveBeenCalled();
    expect(text).toContain('"service": "instagram"');
    expect(text).toContain('"mechanism": "secret"');
    expect(text).toContain('OPENAI_API_KEY');
  });

  it('lists the accounts of the person the call is made for', async () => {
    const { tool, service } = harness();
    const text = textOf(await tool.listIntegrationAccounts({}, null, agent()));
    expect(service.listAccounts).toHaveBeenCalledWith('user-1');
    expect(text).toContain('"id": "acc-1"');
    expect(text).toContain('"accountKey": "miybot"');
    expect(text).toContain('"status": "pending"');
  });

  it('never returns cookies, secrets, tokens or passwords', async () => {
    const { tool } = harness();
    const text = textOf(await tool.listIntegrationAccounts({}, null, agent()));
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('cookies');
    expect(text).not.toContain('"secret"');
    expect(text).not.toContain('"token"');
    expect(text).not.toContain('"password"');
  });
});

describe('IntegrationTool — connecting', () => {
  it('connects an account through the service with the mapped arguments', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.createIntegrationAccount(
        {
          service: 'instagram',
          accountKey: 'miybot',
          label: 'Main IG',
        },
        null,
        agent(),
      ),
    );
    expect(service.connect).toHaveBeenCalledWith(
      'user-1',
      'instagram',
      'miybot',
      'Main IG',
    );
    expect(text).toContain('"id": "acc-1"');
    expect(text).toContain('"label": "Main IG"');
    expect(text).not.toContain(SENTINEL);
  });

  it('points an unknown service at the catalogue tool', async () => {
    const { tool, service } = harness();
    service.connect.mockRejectedValue(
      new BadRequestException('Unknown service "nope".'),
    );
    const result = await tool.createIntegrationAccount(
      { service: 'nope', accountKey: 'x' },
      null,
      agent(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Unknown service "nope"');
    expect(textOf(result)).toContain('list_integration_catalogue');
  });
});

describe('IntegrationTool — login', () => {
  it('returns the site, help page and instructions for the person', async () => {
    const { tool, service } = harness();
    const text = textOf(
      await tool.requestIntegrationLogin({ id: 'acc-1' }, null, agent()),
    );
    expect(service.openLogin).toHaveBeenCalledWith('user-1', 'acc-1');
    expect(text).toContain('https://www.instagram.com/accounts/login/');
    expect(text).toContain('https://admin.test/sessions');
    expect(text).toContain('log in as @miybot');
  });

  it('reports a missing account and names the list tool', async () => {
    const { tool, service } = harness();
    service.openLogin.mockRejectedValue(new NotFoundException());
    const text = textOf(
      await tool.requestIntegrationLogin({ id: 'ghost' }, null, agent()),
    );
    expect(text).toContain('not found');
    expect(text).toContain('list_integration_accounts');
  });

  it('explains that a secret-mechanism account has no login flow', async () => {
    const { tool, service } = harness();
    service.openLogin.mockRejectedValue(
      new BadRequestException(
        'Service "openai" uses mechanism "secret". Login flow is only available for browser-mechanism services.',
      ),
    );
    const result = await tool.requestIntegrationLogin(
      { id: 'acc-2' },
      null,
      agent(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('mechanism "secret"');
    expect(textOf(result)).toContain('console');
  });
});

describe('IntegrationTool — disconnecting', () => {
  it('disconnects once confirmed and names the account', async () => {
    const { tool, service } = harness();
    const result = await tool.deleteIntegrationAccount(
      { id: 'acc-1', confirm: true },
      null,
      agent(),
    );
    expect(service.getAccount).toHaveBeenCalledWith('user-1', 'acc-1');
    expect(service.disconnect).toHaveBeenCalledWith('user-1', 'acc-1');
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('"ok": true');
    expect(textOf(result)).toContain('Main IG');
    expect(textOf(result)).not.toContain(SENTINEL);
  });

  it('refuses without confirm, names the account, and does not touch the service', async () => {
    const { tool, service } = harness();
    const result = await tool.deleteIntegrationAccount(
      { id: 'acc-1' },
      null,
      agent(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('instagram account «Main IG»');
    expect(textOf(result)).toContain('confirm: true');
    expect(service.disconnect).not.toHaveBeenCalled();
  });

  it('falls back to the accountKey when the account has no label', async () => {
    const { tool, service } = harness();
    service.getAccount.mockResolvedValue(account({ label: null }));
    const result = await tool.deleteIntegrationAccount(
      { id: 'acc-1' },
      null,
      agent(),
    );
    expect(textOf(result)).toContain('«miybot»');
  });

  it('reports a missing account before asking for confirmation', async () => {
    const { tool, service } = harness();
    service.getAccount.mockRejectedValue(new NotFoundException());
    const result = await tool.deleteIntegrationAccount(
      { id: 'ghost' },
      null,
      agent(),
    );
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('not found');
    expect(textOf(result)).toContain('list_integration_accounts');
    expect(service.disconnect).not.toHaveBeenCalled();
  });
});
