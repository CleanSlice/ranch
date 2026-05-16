// Discriminated union — extend with `| { type: 'slack'; config: … }` etc.
// when adding new channel types. The runtime reads channel-specific env
// vars (TELEGRAM_BOT_TOKEN, SLACK_BOT_TOKEN, …) — workflow gateway
// flattens this shape into those env vars at workflow submit time.
export type IAgentChannel = {
  type: 'telegram';
  config: {
    botToken: string;
    botName?: string;
    adminIds?: string;
  };
};

// On-disk shape stored at agents/{id}/data/channels.json. Mirrors the
// runtime's IChannelsFile (object keyed by channel type) so the same
// file is the single source of truth for both the API and the runtime.
// The runtime mutates this file via its channel_* tools; the API mutates
// it via PUT /agents/:id/channels — last write wins.
export interface IChannelsFile {
  telegram?: ITelegramFileEntry;
}

export interface ITelegramFileEntry {
  botToken: string;
  botName?: string;
  adminIds?: string;
}
