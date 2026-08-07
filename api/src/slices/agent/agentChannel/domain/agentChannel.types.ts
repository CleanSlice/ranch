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
  // Live state merged from the runtime-written status file. null = unknown
  // (agent predates status reporting or never attempted a start) — distinct
  // from false (a start attempt failed, see statusReason). Absent on PUT
  // input; ignored if supplied.
  connected?: boolean | null;
  statusReason?: string | null;
  statusUpdatedAt?: number | null;
};

// In-memory aggregate of the agent's channel configs, keyed by type. The
// on-disk source of truth is the runtime's per-channel layout
// (data/channels/telegram.json — shared with the runtime's ITelegramFile);
// the pre-split flat file (data/channels.json) survives only as a frozen
// read-only fallback for agents configured before the convergence.
export interface IChannelsFile {
  telegram?: ITelegramFileEntry;
}

export interface ITelegramFileEntry {
  botToken?: string;
  botName?: string;
  adminIds?: string;
  // Tombstone: channel explicitly removed. Blocks the legacy fallback here
  // and the env fallback in the runtime (the pod env keeps the old token
  // until the next redeploy). Mutually exclusive with credentials.
  removed?: boolean;
  // Runtime-owned group registry — the API must preserve it verbatim when
  // rewriting config fields (read-modify-write, never clobber).
  groups?: Record<string, unknown>;
}

// data/channels/status.json — runtime-written report of live channel state.
// The API only reads it; absence of the file or of a key means "unknown",
// never "disconnected".
export interface IChannelStatusEntry {
  connected: boolean;
  error?: string;
  updatedAt: number;
}

export type IChannelStatusFile = Record<string, IChannelStatusEntry>;
