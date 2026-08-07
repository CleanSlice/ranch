// Domain types for an agent's messaging channels. Discriminated union — v1 is
// telegram-only; add variants here as the backend gains support.

export type IAgentChannel = {
  type: 'telegram';
  config: {
    botToken: string;
    botName?: string;
    adminIds?: string;
  };
  // Live state reported by the runtime via the channels endpoint. null (or
  // absent) = unknown — the agent hasn't reported status yet; distinct from
  // false, which means the last start attempt failed (see statusReason).
  connected?: boolean | null;
  statusReason?: string | null;
  statusUpdatedAt?: number | null;
};
