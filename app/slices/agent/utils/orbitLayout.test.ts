import { describe, expect, test } from 'bun:test';
import { orbitLayout, orbitOrder, RING_CAPACITY } from './orbitLayout';

const near = (a: number | undefined, b: number) => Math.abs((a ?? NaN) - b) < 1e-9;

const agent = (status: string, isAdmin = false, name = status) => ({
  name,
  status,
  isAdmin,
});

describe('orbitOrder', () => {
  test('live agents first, admin ahead of them, then by server order', () => {
    const ordered = orbitOrder([
      agent('stopped', false, 's'),
      agent('running', false, 'r1'),
      agent('failed', false, 'f'),
      agent('running', true, 'admin'),
      agent('deploying', false, 'd'),
      agent('running', false, 'r2'),
      agent('pending', false, 'p'),
    ]);
    expect(ordered.map((a) => a.name)).toEqual([
      'admin',
      'r1',
      'r2',
      'd',
      'p',
      'f',
      's',
    ]);
  });

  test('a status we have no rank for goes last, in its own order', () => {
    const ordered = orbitOrder([
      agent('weird', false, 'w1'),
      agent('stopped'),
      agent('weird', false, 'w2'),
    ]);
    expect(ordered.map((a) => a.name)).toEqual(['stopped', 'w1', 'w2']);
  });
});

describe('orbitLayout', () => {
  test('one ring until the inner capacity is reached', () => {
    const { nodes, radii } = orbitLayout(
      Array.from({ length: RING_CAPACITY[0] as number }, () => agent('running')),
    );
    expect(radii).toEqual([1]);
    expect(nodes.every((n) => n.ring === 0)).toBe(true);
  });

  test('the first node sits straight above the hub', () => {
    const { nodes } = orbitLayout([agent('running'), agent('running')]);
    expect(near(nodes[0]?.x, 0)).toBe(true);
    expect(near(nodes[0]?.y, -1)).toBe(true);
    expect(near(nodes[1]?.y, 1)).toBe(true);
  });

  test('overflow opens a second ring', () => {
    const { nodes, radii } = orbitLayout(
      Array.from({ length: (RING_CAPACITY[0] as number) + 3 }, (_, i) =>
        agent(i < 10 ? 'running' : 'stopped'),
      ),
    );
    expect(radii).toEqual([0.54, 1]);
    expect(nodes.filter((n) => n.ring === 0).length).toBe(
      RING_CAPACITY[0] as number,
    );
    expect(nodes.filter((n) => n.ring === 1).length).toBe(3);
  });

  test('nodes on a ring are spread evenly', () => {
    const { nodes } = orbitLayout([
      agent('running'),
      agent('running'),
      agent('running'),
      agent('running'),
    ]);
    const angles = nodes.map((n) => n.angle);
    for (let i = 1; i < angles.length; i++) {
      expect(near(angles[i], (angles[i - 1] as number) + Math.PI / 2)).toBe(true);
    }
  });
});
