import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { SettingTool } from './setting.tool';
import type {
  IInfraConfigGateway,
  ISettingData,
  ISettingGateway,
} from './domain';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * Settings hold the bridle secret and the AWS keys, so what matters most here
 * is that a plain agent never sees these tools, that a secret value is never
 * echoed, and that a misspelt key comes back with the key that was meant —
 * a model that reads "not found" and invents a new row has failed the person.
 */
const row = (overrides: Partial<ISettingData> = {}): ISettingData => ({
  id: 'setting-1',
  group: 'integrations',
  name: 's3_bucket',
  valueType: 'string',
  value: 'ranch-agent-data',
  updatedAt: new Date('2026-09-17T10:00:00.000Z'),
  ...overrides,
});

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

function harness() {
  const settings = {
    findByKey: jest.fn().mockResolvedValue(row()),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const infraConfig = { invalidate: jest.fn() };
  const tool = new SettingTool(
    settings as unknown as ISettingGateway,
    infraConfig as unknown as IInfraConfigGateway,
  );
  return { tool, settings, infraConfig };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('SettingTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a call from a plain agent even by name', async () => {
    const { tool, settings } = harness();
    await expect(
      tool.getSetting(
        { group: 'integrations', name: 's3_bucket' },
        null,
        plainAgent(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(settings.findByKey).not.toHaveBeenCalled();
  });
});

describe('SettingTool — get_setting', () => {
  it('returns the row with its catalogued meaning', async () => {
    const { tool, settings } = harness();
    const text = textOf(
      await tool.getSetting(
        { group: 'integrations', name: 's3_bucket' },
        null,
        operator(),
      ),
    );
    expect(settings.findByKey).toHaveBeenCalledWith(
      'integrations',
      's3_bucket',
    );
    expect(text).toContain('ranch-agent-data');
    expect(text).toContain('"restartRequired": true');
    expect(text).toContain('S3 bucket for agent persistence');
  });

  it('reports a secret as set without echoing it', async () => {
    const { tool, settings } = harness();
    settings.findByKey.mockResolvedValue(
      row({ name: 'bridle_api_key', value: 'hunter2-bridle-secret' }),
    );
    const text = textOf(
      await tool.getSetting(
        { group: 'integrations', name: 'bridle_api_key' },
        null,
        operator(),
      ),
    );
    expect(text).not.toContain('hunter2-bridle-secret');
    expect(text).toContain('(secret — set)');
  });

  it('names the nearest catalogued key when the row does not exist', async () => {
    const { tool, settings } = harness();
    settings.findByKey.mockResolvedValue(null);
    const text = textOf(
      await tool.getSetting(
        { group: 'integrations', name: 's3_buckt' },
        null,
        operator(),
      ),
    );
    expect(text).toContain('«integrations.s3_buckt» is not set');
    expect(text).toContain('Did you mean «integrations.s3_bucket»');
    expect(text).toContain('list_settings');
  });

  it('offers no guess when nothing in the group is close', async () => {
    const { tool, settings } = harness();
    settings.findByKey.mockResolvedValue(null);
    const text = textOf(
      await tool.getSetting(
        { group: 'integrations', name: 'zzz' },
        null,
        operator(),
      ),
    );
    expect(text).not.toContain('Did you mean');
    expect(text).toContain('list_settings');
  });
});

describe('SettingTool — delete_setting', () => {
  it('refuses without the confirmation argument and touches nothing', async () => {
    const { tool, settings, infraConfig } = harness();
    const result = await tool.deleteSetting(
      { group: 'integrations', name: 's3_bucket' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('reset «integrations.s3_bucket»');
    expect(textOf(result)).toContain('confirm: true');
    expect(settings.delete).not.toHaveBeenCalled();
    expect(infraConfig.invalidate).not.toHaveBeenCalled();
  });

  it('reports a missing row before asking for confirmation', async () => {
    const { tool, settings } = harness();
    settings.findByKey.mockResolvedValue(null);
    const result = await tool.deleteSetting(
      { group: 'integrations', name: 's3_buckt' },
      null,
      operator(),
    );
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('Did you mean «integrations.s3_bucket»');
    expect(settings.delete).not.toHaveBeenCalled();
  });

  it('deletes once confirmed and says agents need a restart for a deploy-time key', async () => {
    const { tool, settings, infraConfig } = harness();
    const text = textOf(
      await tool.deleteSetting(
        { group: 'integrations', name: 's3_bucket', confirm: true },
        null,
        operator(),
      ),
    );
    expect(settings.delete).toHaveBeenCalledWith('integrations', 's3_bucket');
    expect(infraConfig.invalidate).not.toHaveBeenCalled();
    expect(text).toContain('«integrations.s3_bucket» removed');
    expect(text).toContain('restart_agent');
  });

  it('drops the infrastructure cache as the controller does', async () => {
    const { tool, settings, infraConfig } = harness();
    settings.findByKey.mockResolvedValue(
      row({ group: 'infrastructure', name: 'argo_url', value: 'http://argo' }),
    );
    const text = textOf(
      await tool.deleteSetting(
        { group: 'infrastructure', name: 'argo_url', confirm: true },
        null,
        operator(),
      ),
    );
    expect(settings.delete).toHaveBeenCalledWith('infrastructure', 'argo_url');
    expect(infraConfig.invalidate).toHaveBeenCalledTimes(1);
    expect(text).not.toContain('restart_agent');
  });
});
