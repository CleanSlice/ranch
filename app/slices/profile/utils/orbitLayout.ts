// Where each agent sits around the person in "Who you talk to": the agent
// written to most on the inner ring, the rest further out (CLEAN-258). Pure on
// purpose: no Vue, no Nuxt aliases, so `bun test` runs it.
//
// Every number here is the prototype's, from `agentsBlock()` in
// specs/038-profile-stats-dashboard/reference/profile-stats-prototype.html.
// They were tuned together by eye; change one and look at the picture.

export interface IOrbitAgent {
  id: string;
  /** The person's own messages to this agent in the period. */
  messages: number;
}

export interface IOrbitNode {
  id: string;
  /** 0 inner, 1 middle, 2 outer. */
  ring: 0 | 1 | 2;
  /** The ring's radius in the box's units. */
  radius: number;
  /** Radians, clockwise from the positive x axis as SVG counts them. */
  angle: number;
  /** The node's centre in the box. */
  x: number;
  y: number;
  /** The side of the node's square. */
  size: number;
}

/** The SVG `viewBox` is `0 0 240 240`, the person in the middle. */
export const ORBIT_SIZE = 240;
export const ORBIT_CENTER = ORBIT_SIZE / 2;

/** Ring radii, inner to outer. */
export const ORBIT_RINGS = [52, 80, 106] as const;

/** The first agent on the inner ring, the next two on the middle one. */
const INNER_COUNT = 1;
const MIDDLE_COUNT = 2;

/** The first node starts at the top (-90°), turned 18° clockwise. */
const START_DEGREES = -90;
const TURN_DEGREES = 18;

/** A node is 18 units for an agent hardly written to, 30 for the busiest. */
export const ORBIT_NODE_MIN = 18;
export const ORBIT_NODE_GROWTH = 12;

function ringOf(index: number): 0 | 1 | 2 {
  if (index < INNER_COUNT) return 0;
  return index < INNER_COUNT + MIDDLE_COUNT ? 1 : 2;
}

/**
 * One node per agent, in the order given.
 *
 * The agents arrive ranked by messages, most first, and are not sorted again
 * here: the list beside the orbit shows the same order, and two sorts could
 * disagree on a tie. The angle goes by position in the list, a full turn
 * shared equally, which is what keeps nodes on different rings apart.
 *
 * What the numbers hold, measured: up to 13 agents no two nodes touch at any
 * sizes; from 14 on, neighbours on the outer ring can meet. A node on the
 * outer ring as large as the busiest one (a tie) reaches up to one unit past
 * the box, so the SVG that draws this must not clip its overflow.
 */
export function orbitLayout(agents: readonly IOrbitAgent[]): IOrbitNode[] {
  if (!agents.length) return [];

  let busiest = 0;
  for (let i = 0; i < agents.length; i++) {
    const messages = agents[i]?.messages ?? 0;
    if (messages > busiest) busiest = messages;
  }
  // Nobody written to: every node the smallest size, and no division by zero.
  const scale = busiest || 1;
  const step = 360 / agents.length;

  return agents.map((agent, index) => {
    const ring = ringOf(index);
    const radius = ORBIT_RINGS[ring];
    const angle = ((START_DEGREES + index * step + TURN_DEGREES) * Math.PI) / 180;
    const share = Math.max(0, agent.messages) / scale;
    return {
      id: agent.id,
      ring,
      radius,
      angle,
      x: ORBIT_CENTER + radius * Math.cos(angle),
      y: ORBIT_CENTER + radius * Math.sin(angle),
      size: ORBIT_NODE_MIN + ORBIT_NODE_GROWTH * (Number.isFinite(share) ? share : 0),
    };
  });
}
