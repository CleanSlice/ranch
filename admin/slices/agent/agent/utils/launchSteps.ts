// What a launch of an agent looks like as a list of steps (CLEAN-247).
//
// Pure on purpose: no Vue, no Nuxt alias, no clock, no wording. It returns
// step ids and states; each console puts its own words on them. This file is
// byte-identical in admin and app (scripts/launch-steps-twin.test.ts): edit
// one, copy to the other.
//
// A step is done because a reported fact proves it, never because time went
// by. The list is monotone: it takes the furthest step the facts prove and
// marks everything before it done, so a stage nobody saw (a container that
// was already there, a local run with no pod at all) completes the moment a
// later one is proven.

/** What the server says the launch is. */
export type LaunchKind = 'initial' | 'start' | 'restart';

export type LaunchStepId =
  | 'accepted'
  | 'stopped'
  | 'scheduled'
  | 'container'
  | 'online'
  | 'ready';

export type LaunchStepState = 'upcoming' | 'current' | 'done' | 'failed';

export type LaunchOutcome = 'running' | 'ready' | 'failed' | 'stopped';

/** The pod facts the public status stream carries. */
export interface LaunchPodFacts {
  phase: string;
  ready: boolean;
  containerWaitingReason: string | null;
  /**
   * The server's word that this pod belongs to a launch that has been
   * replaced: it is being deleted, or it started before the current launch
   * began. A restart leaves the old pod Running for as long as it takes to
   * terminate; without this it would read as the new one.
   */
  superseded: boolean;
}

export interface LaunchFacts {
  kind: LaunchKind;
  /** The start/restart call has not answered yet. */
  requestInFlight: boolean;
  /** The agent's status, as received. */
  status: string;
  /** The server's reason for a failure, as received. */
  statusReason: string | null;
  pod: LaunchPodFacts | null;
  /** The agent's runtime is on the hub. */
  hubConnected: boolean;
  /**
   * The instance that was there before this launch has left the hub (or
   * there was none: a start). Until then the pod and the hub still describe
   * the OLD instance, and reading them would tick the whole list at the
   * click. It gates every kind of launch, not only a restart: someone who
   * may not manage the agent is not told which kind it is, and their list
   * must be right too.
   */
  wentDown: boolean;
  tools: 'connecting' | 'limited' | null;
  /**
   * How far an earlier reading of this same launch got (`LaunchView.reached`).
   * Facts can flicker; the list does not go back.
   */
  floor?: number;
}

export interface LaunchStep {
  id: LaunchStepId;
  state: LaunchStepState;
  /** Why it failed, as received. Only with `failed`. */
  reason: string | null;
}

export interface LaunchView {
  kind: LaunchKind;
  steps: LaunchStep[];
  outcome: LaunchOutcome;
  /** Index of the last step proven done, -1 when none. Feed back as `floor`. */
  reached: number;
}

const WITHOUT_OLD_INSTANCE: LaunchStepId[] = [
  'accepted',
  'scheduled',
  'container',
  'online',
  'ready',
];

const ORDER: Record<LaunchKind, LaunchStepId[]> = {
  initial: WITHOUT_OLD_INSTANCE,
  start: WITHOUT_OLD_INSTANCE,
  // Only a restart has something to take down first.
  restart: ['accepted', 'stopped', 'scheduled', 'container', 'online', 'ready'],
};

// The pod is up and the runtime never reached the hub: Ranch's own verdict,
// and for a launch it is a failure of the `online` step.
const FAILED_STATUSES = new Set(['failed', 'unreachable']);

export function launchStepIds(kind: LaunchKind): LaunchStepId[] {
  return ORDER[kind];
}

export function deriveLaunch(facts: LaunchFacts): LaunchView {
  const ids = ORDER[facts.kind];
  // The pod and the hub speak for the new instance only once the call has
  // been answered, the old instance has left the hub, and the server does
  // not mark the pod as the one being replaced. Three gates on purpose: each
  // alone has a moment when it is late.
  const fresh = !facts.requestInFlight && facts.wentDown;
  const pod = fresh && facts.pod && !facts.pod.superseded ? facts.pod : null;
  const online = fresh && facts.hubConnected;

  const proven: Record<LaunchStepId, boolean> = {
    accepted: !facts.requestInFlight,
    stopped: facts.wentDown,
    scheduled:
      pod !== null &&
      (pod.phase === 'Running' || pod.containerWaitingReason !== null),
    container: pod !== null && pod.phase === 'Running',
    online,
    // The same condition under which the chat is usable.
    ready: online && facts.status === 'running' && facts.tools !== 'connecting',
  };

  let reached = facts.floor ?? -1;
  for (let i = ids.length - 1; i > reached; i -= 1) {
    const id = ids[i];
    if (id !== undefined && proven[id]) {
      reached = i;
      break;
    }
  }
  if (reached > ids.length - 1) reached = ids.length - 1;

  const failed = FAILED_STATUSES.has(facts.status);
  const steps: LaunchStep[] = ids.map((id, index) => {
    if (index <= reached) return { id, state: 'done', reason: null };
    if (index > reached + 1) return { id, state: 'upcoming', reason: null };
    if (!failed) return { id, state: 'current', reason: null };
    return {
      id,
      state: 'failed',
      reason: facts.statusReason ?? pod?.containerWaitingReason ?? null,
    };
  });

  let outcome: LaunchOutcome = 'running';
  if (facts.status === 'stopped') outcome = 'stopped';
  else if (reached === ids.length - 1) outcome = 'ready';
  else if (failed) outcome = 'failed';

  return { kind: facts.kind, steps, outcome, reached };
}
