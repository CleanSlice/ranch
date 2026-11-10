// Where each agent sits on the orbit map. Pure on purpose: no Vue, no Nuxt
// aliases, so `bun test` runs it.
//
// The map means something (owner review, CLEAN-215): distance from the hub is
// weight. Agents that hold a pod sit close, the ones given more CPU and
// memory closest; agents that hold nothing (stopped, failed) drift to the
// outer ring. Lines between nodes are agent-to-agent connections.

export interface OrbitNode<T> {
  agent: T;
  /** Ring index, 0 = innermost. */
  ring: number;
  /** What the ring stands for. */
  band: OrbitBand;
  /** Angle in radians, -π/2 is twelve o'clock. */
  angle: number;
  /** Position relative to the hub, in units of the outermost radius (0..1). */
  x: number;
  y: number;
}

/** `heavy`: active, the larger allocations. `light`: active, the smaller
 *  ones. `idle`: no pod, so nothing allocated right now. */
export type OrbitBand = 'heavy' | 'light' | 'idle';

export interface IOrbitAgent {
  status: string;
  isAdmin: boolean;
  resources?: { cpu?: string; memory?: string } | null;
}

/** Statuses that hold, or are about to hold, a pod. */
const ACTIVE: Record<string, number> = { running: 0, deploying: 1, pending: 2 };
/** Order on the idle ring: what needs attention first. */
const IDLE_RANK: Record<string, number> = { failed: 0, stopped: 1 };

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
  if (ringCount === 3) return [0.4, 0.7, 1];
  // More than three only when a band overflows: spread them evenly.
  const out: number[] = [];
  for (let i = 0; i < ringCount; i++) {
    out.push(0.34 + (0.66 * i) / (ringCount - 1));
  }
  return out;
}

/** Kubernetes CPU quantity in cores: `500m` → 0.5, `2` → 2. Unknown → 0. */
export function parseCpu(value: string | null | undefined): number {
  const raw = (value ?? '').trim();
  if (!raw) return 0;
  const milli = raw.endsWith('m');
  const n = Number(milli ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return milli ? n / 1000 : n;
}

const MEMORY_UNITS: Array<[string, number]> = [
  ['Ki', 1 / (1024 * 1024)],
  ['Mi', 1 / 1024],
  ['Gi', 1],
  ['Ti', 1024],
  ['K', 1e3 / 2 ** 30],
  ['M', 1e6 / 2 ** 30],
  ['G', 1e9 / 2 ** 30],
  ['T', 1e12 / 2 ** 30],
];

/** Kubernetes memory quantity in GiB: `512Mi` → 0.5, `2Gi` → 2, a bare
 *  number is bytes. Unknown → 0. */
export function parseMemory(value: string | null | undefined): number {
  const raw = (value ?? '').trim();
  if (!raw) return 0;
  for (let i = 0; i < MEMORY_UNITS.length; i++) {
    const unit = MEMORY_UNITS[i] as [string, number];
    if (raw.endsWith(unit[0])) {
      const n = Number(raw.slice(0, -unit[0].length));
      return Number.isFinite(n) && n > 0 ? n * unit[1] : 0;
    }
  }
  const bytes = Number(raw);
  return Number.isFinite(bytes) && bytes > 0 ? bytes / 2 ** 30 : 0;
}

/**
 * One number for "how much this agent was given": cores plus half the
 * gibibytes. The halving is the ratio the templates themselves use (the
 * default allocation is 1 core to 2 GiB), so an agent with twice the default
 * of either weighs the same.
 */
export function resourceWeight(
  resources: { cpu?: string; memory?: string } | null | undefined,
): number {
  return parseCpu(resources?.cpu) + parseMemory(resources?.memory) / 2;
}

/**
 * Which band an agent belongs to.
 *
 * Active agents are split in two by weight around the midpoint between the
 * lightest and the heaviest of them: at or above it is `heavy`, below it is
 * `light`. When every active agent was given the same, there is nothing to
 * tell apart and they all share the inner ring.
 */
export function orbitBands<T extends IOrbitAgent>(
  agents: readonly T[],
): OrbitBand[] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i] as T;
    if (!(agent.status in ACTIVE)) continue;
    const w = resourceWeight(agent.resources);
    if (w < min) min = w;
    if (w > max) max = w;
  }
  const split = max > min ? (max + min) / 2 : -Infinity;
  const out: OrbitBand[] = [];
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i] as T;
    if (!(agent.status in ACTIVE)) out.push('idle');
    else out.push(resourceWeight(agent.resources) >= split ? 'heavy' : 'light');
  }
  return out;
}

const BAND_ORDER: OrbitBand[] = ['heavy', 'light', 'idle'];

/**
 * Lays the agents out on concentric rings, one band after another from the
 * hub outwards. A band with more agents than its ring holds spills onto a
 * ring of its own behind it, so the order of the bands never changes.
 *
 * Inside a ring: the admin agent first, then the heavier allocations, then
 * by status, then the order the server gave, so two agents keep their places
 * between polls. The innermost ring starts at twelve o'clock and every ring
 * spreads its nodes evenly; each further ring is turned so its nodes stand in
 * the gaps of the ring inside it (see `ringTurn`).
 */
export function orbitLayout<T extends IOrbitAgent>(
  agents: readonly T[],
): { nodes: OrbitNode<T>[]; radii: number[]; bands: OrbitBand[] } {
  const bandOf = orbitBands(agents);
  const rings: Array<{ band: OrbitBand; members: T[] }> = [];

  for (let b = 0; b < BAND_ORDER.length; b++) {
    const band = BAND_ORDER[b] as OrbitBand;
    const members: Array<{ agent: T; index: number; weight: number }> = [];
    for (let i = 0; i < agents.length; i++) {
      if (bandOf[i] !== band) continue;
      const agent = agents[i] as T;
      members.push({ agent, index: i, weight: resourceWeight(agent.resources) });
    }
    if (!members.length) continue;
    const rank = band === 'idle' ? IDLE_RANK : ACTIVE;
    members.sort((a, c) => {
      if (a.agent.isAdmin !== c.agent.isAdmin) return a.agent.isAdmin ? -1 : 1;
      if (a.weight !== c.weight) return c.weight - a.weight;
      const ra = rank[a.agent.status] ?? 9;
      const rc = rank[c.agent.status] ?? 9;
      if (ra !== rc) return ra - rc;
      return a.index - c.index;
    });
    let cursor = 0;
    while (cursor < members.length) {
      const capacity =
        RING_CAPACITY[rings.length] ??
        (RING_CAPACITY[RING_CAPACITY.length - 1] as number);
      const slice: T[] = [];
      for (let k = cursor; k < Math.min(members.length, cursor + capacity); k++) {
        slice.push((members[k] as { agent: T }).agent);
      }
      rings.push({ band, members: slice });
      cursor += capacity;
    }
  }

  const radii = ringRadii(rings.length);
  const nodes: OrbitNode<T>[] = [];
  let inner: number[] = [];
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r] as { band: OrbitBand; members: T[] };
    const radius = radii[r] ?? 1;
    const count = ring.members.length;
    const turn = ringTurn(count, inner);
    const angles: number[] = [];
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + turn + (i * 2 * Math.PI) / count;
      angles.push(angle);
      nodes.push({
        agent: ring.members[i] as T,
        ring: r,
        band: ring.band,
        angle,
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      });
    }
    inner = angles;
  }
  return { nodes, radii, bands: rings.map((ring) => ring.band) };
}

/** How many candidate turns of a ring are tried: sixteenths of a step. */
const TURN_CANDIDATES = 16;

/**
 * How far to turn a ring, in radians, so its nodes stand in the gaps of the
 * ring inside it. A label points away from the hub, so a node sitting right
 * behind another one covers that one's name; the turn that keeps the nearest
 * pair of nodes on the two rings furthest apart avoids as much of that as
 * the two counts allow. The innermost ring is not turned: its first node is
 * straight above the hub.
 */
export function ringTurn(count: number, innerAngles: readonly number[]): number {
  if (!count || !innerAngles.length) return 0;
  const step = (2 * Math.PI) / count;
  let best = 0;
  let bestGap = -1;
  for (let k = 0; k < TURN_CANDIDATES; k++) {
    const turn = (k * step) / TURN_CANDIDATES;
    let gap = Infinity;
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + turn + i * step;
      for (let j = 0; j < innerAngles.length; j++) {
        let d = Math.abs(angle - (innerAngles[j] as number)) % (2 * Math.PI);
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (d < gap) gap = d;
      }
    }
    // Strictly better only: among equals the smallest turn wins, so the
    // layout does not flip between two equivalent positions.
    if (gap > bestGap + 1e-9) {
      bestGap = gap;
      best = turn;
    }
  }
  return best;
}

/** A drawn connection between two placed agents. */
export interface OrbitLink {
  from: string;
  to: string;
  /** Both agents can ask each other. */
  mutual: boolean;
}

/**
 * The connections worth drawing: both ends are on the map, an agent is not
 * linked to itself, and A→B with B→A is one line marked mutual, not two
 * lines on top of each other.
 */
export function orbitLinks(
  links: ReadonlyArray<{ agentId: string; peerAgentId: string }>,
  present: ReadonlySet<string>,
): OrbitLink[] {
  const seen = new Map<string, OrbitLink>();
  for (let i = 0; i < links.length; i++) {
    const link = links[i] as { agentId: string; peerAgentId: string };
    const a = link.agentId;
    const b = link.peerAgentId;
    if (a === b || !present.has(a) || !present.has(b)) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const known = seen.get(key);
    if (!known) seen.set(key, { from: a, to: b, mutual: false });
    else if (known.from !== a) known.mutual = true;
  }
  return Array.from(seen.values());
}
