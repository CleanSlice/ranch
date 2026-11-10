import { describe, expect, test } from 'bun:test';
import {
  orbitBands,
  orbitLayout,
  orbitLinks,
  parseCpu,
  parseMemory,
  resourceWeight,
  RING_CAPACITY,
} from './orbitLayout';

const near = (a: number | undefined, b: number) => Math.abs((a ?? NaN) - b) < 1e-9;

const SMALL = { cpu: '500m', memory: '1Gi' };
const BIG = { cpu: '2', memory: '4Gi' };

const agent = (
  name: string,
  status = 'running',
  resources: { cpu: string; memory: string } | undefined = SMALL,
  isAdmin = false,
) => ({ name, status, isAdmin, resources });

const names = (nodes: Array<{ agent: { name: string } }>) => nodes.map((n) => n.agent.name);

describe('parseCpu', () => {
  test('millicores and whole cores', () => {
    expect(parseCpu('500m')).toBe(0.5);
    expect(parseCpu('2')).toBe(2);
    expect(parseCpu('1.5')).toBe(1.5);
  });
  test('nothing usable is zero', () => {
    expect(parseCpu('')).toBe(0);
    expect(parseCpu(undefined)).toBe(0);
    expect(parseCpu('lots')).toBe(0);
    expect(parseCpu('-1')).toBe(0);
  });
});

describe('parseMemory', () => {
  test('binary units in GiB', () => {
    expect(parseMemory('512Mi')).toBe(0.5);
    expect(parseMemory('2Gi')).toBe(2);
    expect(parseMemory('1Ti')).toBe(1024);
  });
  test('decimal units and bare bytes', () => {
    expect(near(parseMemory('1G'), 1e9 / 2 ** 30)).toBe(true);
    expect(parseMemory(String(2 ** 30))).toBe(1);
  });
  test('nothing usable is zero', () => {
    expect(parseMemory('')).toBe(0);
    expect(parseMemory(null)).toBe(0);
    expect(parseMemory('plenty')).toBe(0);
  });
});

describe('resourceWeight', () => {
  test('cores plus half the gibibytes', () => {
    expect(resourceWeight(SMALL)).toBe(1);
    expect(resourceWeight(BIG)).toBe(4);
    expect(resourceWeight(undefined)).toBe(0);
  });
});

describe('orbitBands', () => {
  test('agents without a pod are idle whatever they were given', () => {
    expect(orbitBands([agent('s', 'stopped', BIG), agent('f', 'failed')])).toEqual([
      'idle',
      'idle',
    ]);
  });
  test('equal allocations all share the inner band', () => {
    expect(orbitBands([agent('a'), agent('b', 'deploying'), agent('c', 'pending')])).toEqual([
      'heavy',
      'heavy',
      'heavy',
    ]);
  });
  test('the larger allocations are heavy, the smaller light', () => {
    expect(
      orbitBands([agent('small'), agent('big', 'running', BIG), agent('off', 'stopped', BIG)]),
    ).toEqual(['light', 'heavy', 'idle']);
  });
  test('an idle giant does not move the split', () => {
    const huge = { cpu: '64', memory: '256Gi' };
    expect(orbitBands([agent('a'), agent('b'), agent('off', 'stopped', huge)])).toEqual([
      'heavy',
      'heavy',
      'idle',
    ]);
  });
});

describe('orbitLayout', () => {
  test('more resources sit closer, agents without a pod on the outside', () => {
    const { nodes, bands } = orbitLayout([
      agent('off', 'stopped', BIG),
      agent('small'),
      agent('big', 'running', BIG),
      agent('broken', 'failed'),
    ]);
    expect(bands).toEqual(['heavy', 'light', 'idle']);
    const ringOf = (name: string) => nodes.find((n) => n.agent.name === name)?.ring;
    expect(ringOf('big')).toBe(0);
    expect(ringOf('small')).toBe(1);
    expect(ringOf('off')).toBe(2);
    expect(ringOf('broken')).toBe(2);
  });

  test('inner rings have the smaller radius', () => {
    const { nodes } = orbitLayout([
      agent('big', 'running', BIG),
      agent('small'),
      agent('off', 'stopped'),
    ]);
    const dist = (name: string) => {
      const n = nodes.find((x) => x.agent.name === name);
      return Math.hypot(n?.x ?? 0, n?.y ?? 0);
    };
    expect(dist('big') < dist('small')).toBe(true);
    expect(dist('small') < dist('off')).toBe(true);
    expect(near(dist('off'), 1)).toBe(true);
  });

  test('inside a ring: admin first, then heavier, then by status, then server order', () => {
    const { nodes } = orbitLayout([
      agent('pending', 'pending'),
      agent('r1'),
      agent('admin', 'running', SMALL, true),
      agent('deploying', 'deploying'),
      agent('r2'),
    ]);
    expect(names(nodes)).toEqual(['admin', 'r1', 'r2', 'deploying', 'pending']);
  });

  test('on the idle ring what failed comes before what was stopped', () => {
    const { nodes } = orbitLayout([agent('s', 'stopped'), agent('f', 'failed'), agent('odd', 'weird')]);
    expect(names(nodes)).toEqual(['f', 's', 'odd']);
  });

  test('one band is one ring at full radius, first node straight above the hub', () => {
    const { nodes, radii } = orbitLayout([agent('a'), agent('b')]);
    expect(radii).toEqual([1]);
    expect(near(nodes[0]?.x, 0)).toBe(true);
    expect(near(nodes[0]?.y, -1)).toBe(true);
    expect(near(nodes[1]?.y, 1)).toBe(true);
  });

  test('an outer ring is turned so its nodes stand in the gaps of the inner one', () => {
    const { nodes } = orbitLayout([agent('a'), agent('off1', 'stopped'), agent('off2', 'stopped')]);
    const first = nodes.find((n) => n.agent.name === 'off1');
    // One node above the hub, two outside: furthest from it is a quarter turn.
    expect(near(first?.angle, -Math.PI / 2 + Math.PI / 2)).toBe(true);
  });

  test('no node of a ring sits right behind a node of the ring inside it', () => {
    const inner = Array.from({ length: 6 }, (_, i) => agent(`big${i}`, 'running', BIG));
    const outer = Array.from({ length: 6 }, (_, i) => agent(`small${i}`));
    const { nodes } = orbitLayout([...inner, ...outer]);
    const innerAngles = nodes.filter((n) => n.ring === 0).map((n) => n.angle);
    for (const node of nodes.filter((n) => n.ring === 1)) {
      const nearest = Math.min(
        ...innerAngles.map((a) => {
          const d = Math.abs(node.angle - a) % (2 * Math.PI);
          return d > Math.PI ? 2 * Math.PI - d : d;
        }),
      );
      // Six and six: the best is half a step, 30 degrees.
      expect(near(nearest, Math.PI / 6)).toBe(true);
    }
  });

  test('a band larger than its ring spills onto the next one and stays in order', () => {
    const many = Array.from({ length: (RING_CAPACITY[0] as number) + 3 }, (_, i) => agent(`a${i}`));
    const { nodes, bands } = orbitLayout([...many, agent('off', 'stopped')]);
    expect(bands).toEqual(['heavy', 'heavy', 'idle']);
    expect(nodes.filter((n) => n.ring === 0).length).toBe(RING_CAPACITY[0] as number);
    expect(nodes.filter((n) => n.ring === 1).length).toBe(3);
    expect(nodes.find((n) => n.agent.name === 'off')?.ring).toBe(2);
  });

  test('no agents, no rings', () => {
    expect(orbitLayout([])).toEqual({ nodes: [], radii: [1], bands: [] });
  });
});

describe('orbitLinks', () => {
  const present = new Set(['a', 'b', 'c']);
  test('keeps connections whose two ends are on the map', () => {
    expect(
      orbitLinks(
        [
          { agentId: 'a', peerAgentId: 'b' },
          { agentId: 'a', peerAgentId: 'gone' },
        ],
        present,
      ),
    ).toEqual([{ from: 'a', to: 'b', mutual: false }]);
  });
  test('both directions are one mutual line', () => {
    expect(
      orbitLinks(
        [
          { agentId: 'a', peerAgentId: 'b' },
          { agentId: 'b', peerAgentId: 'a' },
          { agentId: 'b', peerAgentId: 'c' },
        ],
        present,
      ),
    ).toEqual([
      { from: 'a', to: 'b', mutual: true },
      { from: 'b', to: 'c', mutual: false },
    ]);
  });
  test('a repeated pair is not mutual, and nothing links to itself', () => {
    expect(
      orbitLinks(
        [
          { agentId: 'a', peerAgentId: 'b' },
          { agentId: 'a', peerAgentId: 'b' },
          { agentId: 'c', peerAgentId: 'c' },
        ],
        present,
      ),
    ).toEqual([{ from: 'a', to: 'b', mutual: false }]);
  });
});
