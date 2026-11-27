import { describe, expect, test } from 'bun:test';
import {
  ORBIT_CENTER,
  ORBIT_RINGS,
  ORBIT_SIZE,
  orbitLayout,
  type IOrbitNode,
} from './orbitLayout';

const agents = (...messages: number[]) =>
  messages.map((count, i) => ({ id: `a${i + 1}`, messages: count }));

/** Three decimals: enough to tell two positions apart, deaf to float noise. */
const r3 = (value: number) => Math.round(value * 1000) / 1000;

const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Where the prototype puts node `j` of `n`: its own formula, written out. */
function expected(j: number, n: number, radius: number) {
  const angle = rad(-90 + j * (360 / n) + 18);
  return {
    x: r3(120 + radius * Math.cos(angle)),
    y: r3(120 + radius * Math.sin(angle)),
  };
}

const at = (nodes: IOrbitNode[], i: number): IOrbitNode => {
  const node = nodes[i];
  if (!node) throw new Error(`no node ${i}`);
  return node;
};

describe('the orbit box', () => {
  test('240 by 240, centred, three rings', () => {
    expect(ORBIT_SIZE).toBe(240);
    expect(ORBIT_CENTER).toBe(120);
    expect([...ORBIT_RINGS]).toEqual([52, 80, 106]);
  });
});

describe('orbitLayout', () => {
  test('no agents, nothing to place', () => {
    expect(orbitLayout([])).toEqual([]);
  });

  test('one agent sits on the inner ring at full size', () => {
    const nodes = orbitLayout(agents(12));
    expect(nodes.length).toBe(1);
    const only = at(nodes, 0);
    expect(only.id).toBe('a1');
    expect(only.ring).toBe(0);
    expect(only.radius).toBe(52);
    expect(r3(only.angle)).toBe(r3(rad(-72)));
    expect({ x: r3(only.x), y: r3(only.y) }).toEqual(expected(0, 1, 52));
    expect(only.size).toBe(30);
  });

  test('three agents: one inside, two on the middle ring, a third of a turn apart', () => {
    const nodes = orbitLayout(agents(40, 20, 10));
    expect(nodes.map((n) => n.id)).toEqual(['a1', 'a2', 'a3']);
    expect(nodes.map((n) => n.ring)).toEqual([0, 1, 1]);
    expect(nodes.map((n) => n.radius)).toEqual([52, 80, 80]);
    expect(nodes.map((n) => r3(n.angle))).toEqual([r3(rad(-72)), r3(rad(48)), r3(rad(168))]);
    expect({ x: r3(at(nodes, 1).x), y: r3(at(nodes, 1).y) }).toEqual(expected(1, 3, 80));
    expect({ x: r3(at(nodes, 2).x), y: r3(at(nodes, 2).y) }).toEqual(expected(2, 3, 80));
  });

  test('size follows the share of the busiest agent: 18 to 30', () => {
    expect(orbitLayout(agents(40, 20, 10)).map((n) => n.size)).toEqual([30, 24, 21]);
    expect(orbitLayout(agents(40, 0)).map((n) => n.size)).toEqual([30, 18]);
  });

  test('agents nobody wrote to are all the smallest size, and nothing divides by zero', () => {
    expect(orbitLayout(agents(0, 0)).map((n) => n.size)).toEqual([18, 18]);
  });

  test('nine agents: one, two, and the other six on the outer ring', () => {
    const nodes = orbitLayout(agents(90, 80, 70, 60, 50, 40, 30, 20, 10));
    expect(nodes.map((n) => n.ring)).toEqual([0, 1, 1, 2, 2, 2, 2, 2, 2]);
    expect(nodes.map((n) => n.radius)).toEqual([52, 80, 80, 106, 106, 106, 106, 106, 106]);
    for (let j = 0; j < nodes.length; j++) {
      const node = at(nodes, j);
      expect({ x: r3(node.x), y: r3(node.y) }).toEqual(expected(j, 9, node.radius));
    }
  });

  test('nine agents do not overlap, even at one size', () => {
    const layouts = [
      orbitLayout(agents(90, 80, 70, 60, 50, 40, 30, 20, 10)),
      orbitLayout(agents(5, 5, 5, 5, 5, 5, 5, 5, 5)),
    ];
    for (let l = 0; l < layouts.length; l++) {
      const nodes = layouts[l] ?? [];
      expect(nodes.length).toBe(9);
      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const one = at(nodes, a);
          const other = at(nodes, b);
          // Two squares are apart when they are apart along one axis.
          const reach = (one.size + other.size) / 2;
          const apart =
            Math.abs(one.x - other.x) >= reach || Math.abs(one.y - other.y) >= reach;
          expect(apart).toBe(true);
        }
      }
    }
  });

  test('every centre is inside the box', () => {
    const nodes = orbitLayout(agents(90, 80, 70, 60, 50, 40, 30, 20, 10));
    for (let j = 0; j < nodes.length; j++) {
      const node = at(nodes, j);
      expect(node.x > 0 && node.x < ORBIT_SIZE).toBe(true);
      expect(node.y > 0 && node.y < ORBIT_SIZE).toBe(true);
    }
  });

  test('the order is the one given: the list beside the orbit uses the same', () => {
    // Not re-sorted here; the busiest still sets the scale wherever it stands.
    const nodes = orbitLayout(agents(10, 40));
    expect(nodes.map((n) => n.id)).toEqual(['a1', 'a2']);
    expect(nodes.map((n) => n.ring)).toEqual([0, 1]);
    expect(nodes.map((n) => n.size)).toEqual([21, 30]);
  });
});
