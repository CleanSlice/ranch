import { S3FileGateway } from './file.gateway';
import { ISettingGateway } from '#/setting/domain';

// resyncFromTemplate runs on EVERY restart. The CLEAN-56 bug: it copied the
// template's root SOUL.md over the agent's customized one, so "save + restart"
// silently destroyed operator edits. Identity files are agent-owned once they
// exist — the template only provides them to agents that lack them.

interface ISendCmd {
  constructor: { name: string };
  input: Record<string, unknown>;
}

function buildGateway(setup: {
  agentRootKeys: string[];
  templateKeys: string[];
}) {
  const copied: string[] = [];
  const send = jest.fn((cmd: ISendCmd) => {
    const name = cmd.constructor.name;
    const input = cmd.input;
    if (name === 'ListObjectsV2Command') {
      const prefix = input.Prefix as string;
      if (prefix === 'agents/a1/.agent/')
        return Promise.resolve({ Contents: [] });
      if (prefix === 'agents/a1/' && input.Delimiter === '/') {
        return Promise.resolve({
          Contents: setup.agentRootKeys.map((k) => ({ Key: `agents/a1/${k}` })),
        });
      }
      if (prefix === 'templates/t1/') {
        return Promise.resolve({
          Contents: setup.templateKeys.map((k) => ({
            Key: `templates/t1/${k}`,
          })),
        });
      }
      return Promise.resolve({ Contents: [] });
    }
    if (name === 'CopyObjectCommand') {
      copied.push(input.Key as string);
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });

  const gateway = new S3FileGateway({} as unknown as ISettingGateway);
  jest
    .spyOn(gateway as unknown as { connect: () => Promise<unknown> }, 'connect')
    .mockResolvedValue({ client: { send }, bucket: 'b' });
  return { gateway, copied };
}

describe('S3FileGateway.resyncFromTemplate (CLEAN-56)', () => {
  it('does NOT overwrite existing agent identity files (SOUL.md and friends)', async () => {
    const { gateway, copied } = buildGateway({
      agentRootKeys: ['SOUL.md', 'HEARTBEAT.md'],
      templateKeys: ['SOUL.md', 'HEARTBEAT.md', 'USER.md', 'skills/x/SKILL.md'],
    });
    await gateway.resyncFromTemplate('a1', 't1');
    // Customized identity files survive the restart resync…
    expect(copied).not.toContain('agents/a1/SOUL.md');
    expect(copied).not.toContain('agents/a1/HEARTBEAT.md');
    // …while missing identity files and template-owned content still arrive.
    expect(copied).toContain('agents/a1/USER.md');
    expect(copied).toContain('agents/a1/skills/x/SKILL.md');
  });

  it('seeds identity files for agents that do not have them yet', async () => {
    const { gateway, copied } = buildGateway({
      agentRootKeys: [],
      templateKeys: ['SOUL.md', 'USER.md'],
    });
    await gateway.resyncFromTemplate('a1', 't1');
    expect(copied).toEqual(
      expect.arrayContaining(['agents/a1/SOUL.md', 'agents/a1/USER.md']),
    );
  });

  it('keeps skipping agent-owned prefixes and legacy .agent keys', async () => {
    const { gateway, copied } = buildGateway({
      agentRootKeys: [],
      templateKeys: ['data/seed.json', 'memory/MEMORY.md', '.agent/SOUL.md'],
    });
    await gateway.resyncFromTemplate('a1', 't1');
    expect(copied).toEqual([]);
  });

  it('non-identity root files keep template-wins semantics (updates propagate)', async () => {
    const { gateway, copied } = buildGateway({
      agentRootKeys: ['agent.config.json'],
      templateKeys: ['agent.config.json'],
    });
    await gateway.resyncFromTemplate('a1', 't1');
    expect(copied).toContain('agents/a1/agent.config.json');
  });
});
