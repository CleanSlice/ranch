// Where each agent sits on the orbit map (console redesign, direction A).
// Pure on purpose: no Vue, no Nuxt aliases, so `bun test` runs it.

export interface OrbitNode<T> {
  agent: T;
  /** Ring index, 0 = innermost. */
  ring: number;
  /** Angle in radians, -π/2 is twelve o'clock. */
  angle: number;
  /** Position relative to the hub, in units of the outermost radius (0..1). */
  x: number;
  y: number;
}

/** Rings are filled in this order, so the inner ring is the live ones. */
const STATUS_RANK: Record<string, number> = {
  running: 0,
  deploying: 1,
  pending: 2,
  failed: 3,
  stopped: 4,
};

/** How many nodes a ring takes before the next one opens. */
export const RING_CAPACITY = [12, 22, 32];

/**
 * Radius of each ring as a share of the outermost one. The gaps leave room
 * for a node's label, which always points away from the hub, between it and
 * the next ring.
 */
export function ringRadii(ringCount: number): number[] {
  if (ringCount <= 1) return [1];
  if (ringCount === 2) return [0.54, 1];
  return [0.4, 0.7, 1];
}

/**
 * Live agents first (the admin agent ahead of the rest), then deploying,
 * pending, failed and stopped; the order the server gave them inside each
 * bucket, so two running agents keep their relative places between polls.
 */
export function orbitOrder<T extends { status: string; isAdmin: boolean }>(
  agents: readonly T[],
): T[] {
  return agents
    .map((agent, index) => ({ agent, index }))
    .sort((a, b) => {
      const ra = STATUS_RANK[a.agent.status] ?? 5;
      const rb = STATUS_RANK[b.agent.status] ?? 5;
      if (ra !== rb) return ra - rb;
      if (a.agent.isAdmin !== b.agent.isAdmin) return a.agent.isAdmin ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.agent);
}

/**
 * Lays the ordered agents out on concentric rings. Each ring starts at twelve
 * o'clock and spreads its nodes evenly, so the first running agent is always
 * straight above the hub and a ring with three agents is not a lopsided arc.
 */
export function orbitLayout<T extends { status: string; isAdmin: boolean }>(
  agents: readonly T[],
): { nodes: OrbitNode<T>[]; radii: number[] } {
  const ordered = orbitOrder(agents);
  const rings: T[][] = [];
  let cursor = 0;
  for (let ring = 0; cursor < ordered.length; ring++) {
    const capacity =
      RING_CAPACITY[ring] ?? (RING_CAPACITY[RING_CAPACITY.length - 1] as number);
    rings.push(ordered.slice(cursor, cursor + capacity));
    cursor += capacity;
  }
  const radii = ringRadii(rings.length);
  const nodes: OrbitNode<T>[] = [];
  rings.forEach((members, ring) => {
    const radius = radii[ring] ?? 1;
    const count = members.length;
    members.forEach((agent, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
      nodes.push({
        agent,
        ring,
        angle,
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      });
    });
  });
  return { nodes, radii };
}
