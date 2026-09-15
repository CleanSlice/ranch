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

/** One directed connection: this agent may delegate to `peerAgentId`. */
export interface IAgentPeer {
  id: string;
  agentId: string;
  peerAgentId: string;
  peerName: string;
  peerStatus: string;
  peerExists: boolean;
  /** Read at connect time or last refresh — never live. */
  card: IAgentCard;
  cardUrl: string;
  cardReadAt: string;
  createdAt: string;
}

export interface IAgentPeerCandidate {
  id: string;
  name: string;
  status: string;
  connected: boolean;
}

export interface IAgentDelegation {
  id: string;
  peerAgentId: string;
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
