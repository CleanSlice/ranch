/**
 * Console-side view of agent-to-agent (CLEAN-74). Mirrors the API DTOs; the
 * card shape is the A2A one on purpose, so what an operator reads in the
 * preview is literally what another agent reads.
 */
export interface IAgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface IAgentInterface {
  url: string;
  protocolBinding: string;
  protocolVersion: string;
}

export interface IAgentCard {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: IAgentInterface[];
  capabilities: { streaming?: boolean; pushNotifications?: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: IAgentSkill[];
}

/** One directed connection: this agent may delegate to the peer. */
export interface IAgentPeer {
  id: string;
  agentId: string;
  /** Null for external peers — they have no agent id here (CLEAN-95). */
  peerAgentId: string | null;
  /** 'internal' | 'external' — imported by URL vs an agent of this ranch. */
  origin: 'internal' | 'external';
  peerName: string;
  /** External rows carry 'external' — no live pod status is knowable. */
  peerStatus: string;
  peerExists: boolean;
  /** Read at connect time or last refresh — never live. */
  card: IAgentCard;
  cardUrl: string;
  cardReadAt: string;
  createdAt: string;
}

/** Whether the running pod has loaded the current peer set (CLEAN-95). */
export interface IPeersState {
  armed: boolean;
  servedAt: string | null;
}

export interface IAgentPeerCandidate {
  id: string;
  name: string;
  status: string;
  connected: boolean;
}

export interface IAgentDelegation {
  id: string;
  /** The connection the task went through; null once it was removed. */
  peerId: string | null;
  /** Null for delegations to external peers (CLEAN-95). */
  peerAgentId: string | null;
  peerName: string;
  task: string;
  reason: string;
  status: string;
  errorCode: string | null;
  excerpt: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}
