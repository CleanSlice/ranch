import { detectMcpConfigDrift } from './mcpConfigDrift';

const POD_START = new Date('2026-09-14T10:33:00Z');
const BEFORE = new Date('2026-09-08T12:10:30Z');
const AFTER = new Date('2026-09-14T15:00:00Z');

function server(name: string, updatedAt: Date) {
  return { id: `mcp-${name.toLowerCase()}`, name, updatedAt };
}

describe('detectMcpConfigDrift', () => {
  it('is quiet when every server predates the pod', () => {
    const drift = detectMcpConfigDrift({
      servers: [server('Documents', BEFORE), server('Silpo', BEFORE)],
      podStartedAt: POD_START,
    });

    expect(drift.restartRequired).toBe(false);
    expect(drift.changedServers).toEqual([]);
    expect(drift.configChangedAt).toBeNull();
  });

  it('flags a server edited after the pod started', () => {
    const drift = detectMcpConfigDrift({
      servers: [server('Documents', AFTER), server('Silpo', BEFORE)],
      podStartedAt: POD_START,
    });

    expect(drift.restartRequired).toBe(true);
    expect(drift.changedServers).toEqual(['Documents']);
    expect(drift.configChangedAt).toBe(AFTER.toISOString());
  });

  it('reports the most recent change when several drifted', () => {
    const middle = new Date('2026-09-14T12:00:00Z');
    const drift = detectMcpConfigDrift({
      servers: [server('Documents', AFTER), server('Ranch', middle)],
      podStartedAt: POD_START,
    });

    expect(drift.changedServers.sort()).toEqual(['Documents', 'Ranch']);
    expect(drift.configChangedAt).toBe(AFTER.toISOString());
  });

  it('asks for no restart when there is no pod to restart', () => {
    const drift = detectMcpConfigDrift({
      servers: [server('Documents', AFTER)],
      podStartedAt: null,
    });

    expect(drift.restartRequired).toBe(false);
    expect(drift.podStartedAt).toBeNull();
  });

  it('treats a change at the exact pod start as already applied', () => {
    // The pod read its env at creation; an edit stamped the same second is
    // not evidence the pod missed it, and flagging it would leave an agent
    // permanently marked stale.
    const drift = detectMcpConfigDrift({
      servers: [server('Documents', POD_START)],
      podStartedAt: POD_START,
    });

    expect(drift.restartRequired).toBe(false);
  });

  it('is quiet for an agent with no MCP servers at all', () => {
    const drift = detectMcpConfigDrift({
      servers: [],
      podStartedAt: POD_START,
    });

    expect(drift.restartRequired).toBe(false);
    expect(drift.configChangedAt).toBeNull();
  });

  it('carries the pod start back so a caller can show both sides', () => {
    const drift = detectMcpConfigDrift({
      servers: [server('Documents', AFTER)],
      podStartedAt: POD_START,
    });

    expect(drift.podStartedAt).toBe(POD_START.toISOString());
  });

  it('catches the CLEAN-84 case: a healed url on a long-running pod', () => {
    // The seeder rewrites the built-in url at api boot. Every pod created
    // before that keeps the dead address in its env until it restarts, and
    // logs nothing — there is no server to fail, it simply is not in the
    // list the pod was given.
    const healed = new Date('2026-09-14T16:00:00Z');
    const drift = detectMcpConfigDrift({
      servers: [server('Documents', healed), server('Silpo', BEFORE)],
      podStartedAt: POD_START,
    });

    expect(drift.restartRequired).toBe(true);
    expect(drift.changedServers).toEqual(['Documents']);
  });
});
