// Domain types for an agent's messaging channels. Discriminated union — v1 is
// telegram-only; add variants here as the backend gains support.

export type IAgentChannel = {
  type: 'telegram';
  config: {
    botToken: string;
    botName?: string;
    adminIds?: string;
  };
};
