import { NotFoundException } from '@nestjs/common';
import { AgentChannelGateway } from './agentChannel.gateway';
import { AgentChannelMapper } from './agentChannel.mapper';
import { IFileGateway } from '#/agent/file/domain';

const TELEGRAM_PATH = 'data/channels/telegram.json';
const STATUS_PATH = 'data/channels/status.json';
const LEGACY_PATH = 'data/channels.json';

// In-memory IFileGateway stub — only read/save are exercised here.
function makeFilesStub(seed: Record<string, string> = {}) {
  const files: Record<string, string> = { ...seed };
  const stub = {
    read: jest.fn(async (agentId: string, path: string) => {
      const content = files[path];
      if (content === undefined) {
        throw new NotFoundException(`no such file: ${path}`);
      }
      return { path, content };
    }),
    save: jest.fn(async (_agentId: string, path: string, content: string) => {
      files[path] = content;
    }),
  };
  return { stub: stub as unknown as IFileGateway, files, spies: stub };
}

function makeGateway(seed: Record<string, string> = {}) {
  const { stub, files, spies } = makeFilesStub(seed);
  return { gateway: new AgentChannelGateway(stub, new AgentChannelMapper()), files, spies };
}

describe('AgentChannelGateway.getForAgent', () => {
  test('per-channel file with credentials wins over legacy', async () => {
    const { gateway } = makeGateway({
      [TELEGRAM_PATH]: JSON.stringify({ botToken: 'new:token', botName: 'newbot' }),
      [LEGACY_PATH]: JSON.stringify({ telegram: { botToken: 'old:token' } }),
    });

    const channels = await gateway.getForAgent('a1');

    expect(channels).toHaveLength(1);
    expect(channels[0].config.botToken).toBe('new:token');
  });

  test('falls back to legacy file when per-channel file is absent', async () => {
    const { gateway } = makeGateway({
      [LEGACY_PATH]: JSON.stringify({ telegram: { botToken: 'legacy:token', adminIds: '42' } }),
    });

    const channels = await gateway.getForAgent('a1');

    expect(channels).toHaveLength(1);
    expect(channels[0].config.botToken).toBe('legacy:token');
    expect(channels[0].config.adminIds).toBe('42');
  });

  test('tombstoned per-channel file beats a lingering legacy config', async () => {
    const { gateway } = makeGateway({
      [TELEGRAM_PATH]: JSON.stringify({ removed: true }),
      [LEGACY_PATH]: JSON.stringify({ telegram: { botToken: 'stale:token' } }),
    });

    expect(await gateway.getForAgent('a1')).toEqual([]);
  });

  test('groups-only per-channel file (env/panel-configured bot) still defers to legacy', async () => {
    const { gateway } = makeGateway({
      [TELEGRAM_PATH]: JSON.stringify({ groups: { '-100': { id: '-100' } } }),
      [LEGACY_PATH]: JSON.stringify({ telegram: { botToken: 'panel:token' } }),
    });

    const channels = await gateway.getForAgent('a1');

    expect(channels).toHaveLength(1);
    expect(channels[0].config.botToken).toBe('panel:token');
  });

  test('nothing configured anywhere → []', async () => {
    const { gateway } = makeGateway();
    expect(await gateway.getForAgent('a1')).toEqual([]);
  });

  test('merges live status from status.json', async () => {
    const { gateway } = makeGateway({
      [TELEGRAM_PATH]: JSON.stringify({ botToken: '123:abc' }),
      [STATUS_PATH]: JSON.stringify({
        telegram: { connected: false, error: '401 Unauthorized', updatedAt: 1754550000000 },
      }),
    });

    const [telegram] = await gateway.getForAgent('a1');

    expect(telegram.connected).toBe(false);
    expect(telegram.statusReason).toBe('401 Unauthorized');
    expect(telegram.statusUpdatedAt).toBe(1754550000000);
  });

  test('no status file → connected null (unknown, not disconnected)', async () => {
    const { gateway } = makeGateway({
      [TELEGRAM_PATH]: JSON.stringify({ botToken: '123:abc' }),
    });

    const [telegram] = await gateway.getForAgent('a1');

    expect(telegram.connected).toBeNull();
    expect(telegram.statusReason).toBeNull();
    expect(telegram.statusUpdatedAt).toBeNull();
  });

  test('status file without a telegram key → connected null', async () => {
    const { gateway } = makeGateway({
      [TELEGRAM_PATH]: JSON.stringify({ botToken: '123:abc' }),
      [STATUS_PATH]: JSON.stringify({ bridle: { connected: true, updatedAt: 1 } }),
    });

    const [telegram] = await gateway.getForAgent('a1');

    expect(telegram.connected).toBeNull();
  });
});

describe('AgentChannelGateway.setForAgent', () => {
  test('writes the per-channel file, preserves runtime-owned groups, clears tombstone, never touches legacy', async () => {
    const { gateway, files, spies } = makeGateway({
      [TELEGRAM_PATH]: JSON.stringify({
        removed: true,
        groups: { '-100': { id: '-100', title: 'News' } },
      }),
      [LEGACY_PATH]: JSON.stringify({ telegram: { botToken: 'old:token' } }),
    });

    const result = await gateway.setForAgent('a1', [
      { type: 'telegram', config: { botToken: 'fresh:token', botName: 'freshbot' } },
    ]);

    const saved = JSON.parse(files[TELEGRAM_PATH]);
    expect(saved.botToken).toBe('fresh:token');
    expect(saved.removed).toBeUndefined();
    expect(saved.groups['-100'].title).toBe('News');
    // legacy stays frozen
    expect(JSON.parse(files[LEGACY_PATH]).telegram.botToken).toBe('old:token');
    expect(spies.save).toHaveBeenCalledTimes(1);
    // response mirrors the next GET
    expect(result).toHaveLength(1);
    expect(result[0].config.botToken).toBe('fresh:token');
  });

  test('omitting a configured channel writes a tombstone instead of deleting', async () => {
    const { gateway, files } = makeGateway({
      [TELEGRAM_PATH]: JSON.stringify({ botToken: '123:abc' }),
    });

    const result = await gateway.setForAgent('a1', []);

    expect(JSON.parse(files[TELEGRAM_PATH])).toEqual({ removed: true });
    expect(result).toEqual([]);
  });

  test('omitting a legacy-configured channel also tombstones the per-channel path', async () => {
    const { gateway, files } = makeGateway({
      [LEGACY_PATH]: JSON.stringify({ telegram: { botToken: 'legacy:token' } }),
    });

    await gateway.setForAgent('a1', []);

    expect(JSON.parse(files[TELEGRAM_PATH])).toEqual({ removed: true });
    // legacy is read-only — still intact
    expect(JSON.parse(files[LEGACY_PATH]).telegram.botToken).toBe('legacy:token');
  });

  test('clearing when nothing is configured writes nothing', async () => {
    const { gateway, spies } = makeGateway();

    const result = await gateway.setForAgent('a1', []);

    expect(result).toEqual([]);
    expect(spies.save).not.toHaveBeenCalled();
  });
});
