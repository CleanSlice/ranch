import { ConfigService } from '@nestjs/config';
import { InfraConfigGateway } from './infraConfig.gateway';
import { ISettingGateway } from '../domain/setting.gateway';

/**
 * getApiPublicUrl (CLEAN-74) is the one infra key with a four-step chain:
 * settings → env PUBLIC_API_URL → integrations.ranch_api_url → localhost.
 * The extra step matters because a configured cluster already tells agents
 * where the API lives, and an agent card URL built from a wrong origin is
 * unreachable in a way nothing else in the product would reveal.
 */
type SettingRow = { value: unknown } | null;

function makeHarness(options: {
  settings?: Record<string, SettingRow>;
  env?: Record<string, string>;
  findByKeyThrows?: boolean;
}) {
  const settings = options.settings ?? {};
  const env = options.env ?? {};

  const findByKey = jest.fn(
    async (group: string, name: string): Promise<SettingRow> => {
      if (options.findByKeyThrows) throw new Error('db down');
      return settings[`${group}/${name}`] ?? null;
    },
  );

  const settingGateway = {
    findByKey,
    findByGroup: jest.fn(async () => []),
    upsert: jest.fn(async () => undefined),
  } as unknown as ISettingGateway;

  const configService = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;

  const gateway = new InfraConfigGateway(settingGateway, configService);
  return { gateway, findByKey };
}

describe('InfraConfigGateway.getApiPublicUrl', () => {
  it('prefers the infrastructure setting over everything else', async () => {
    const { gateway } = makeHarness({
      settings: {
        'infrastructure/api_public_url': { value: 'https://api.example.test' },
        'integrations/ranch_api_url': { value: 'http://never.used' },
      },
      env: { PUBLIC_API_URL: 'http://never.used.either' },
    });

    await expect(gateway.getApiPublicUrl()).resolves.toBe(
      'https://api.example.test',
    );
  });

  it('falls back to PUBLIC_API_URL when no setting is stored', async () => {
    const { gateway } = makeHarness({
      env: { PUBLIC_API_URL: 'https://api.from-env.test' },
    });

    await expect(gateway.getApiPublicUrl()).resolves.toBe(
      'https://api.from-env.test',
    );
  });

  it('falls back to the ranch_api_url integration agents already dial', async () => {
    const { gateway, findByKey } = makeHarness({
      settings: {
        'integrations/ranch_api_url': {
          value: 'http://ranch-api.platform:3333',
        },
      },
    });

    await expect(gateway.getApiPublicUrl()).resolves.toBe(
      'http://ranch-api.platform:3333',
    );
    expect(findByKey).toHaveBeenCalledWith('integrations', 'ranch_api_url');
  });

  it('falls back to localhost when nothing is configured anywhere', async () => {
    const { gateway } = makeHarness({});

    await expect(gateway.getApiPublicUrl()).resolves.toBe(
      'http://localhost:3333',
    );
  });

  it('strips trailing slashes so card URLs never double up', async () => {
    const { gateway } = makeHarness({
      env: { PUBLIC_API_URL: 'https://api.example.test///' },
    });

    await expect(gateway.getApiPublicUrl()).resolves.toBe(
      'https://api.example.test',
    );
  });

  it('survives a settings database outage and uses the default', async () => {
    const { gateway } = makeHarness({ findByKeyThrows: true });

    await expect(gateway.getApiPublicUrl()).resolves.toBe(
      'http://localhost:3333',
    );
  });

  it('ignores an empty stored value rather than returning an empty origin', async () => {
    const { gateway } = makeHarness({
      settings: {
        'infrastructure/api_public_url': { value: '' },
        'integrations/ranch_api_url': { value: 'https://api.integration.test' },
      },
    });

    await expect(gateway.getApiPublicUrl()).resolves.toBe(
      'https://api.integration.test',
    );
  });
});
