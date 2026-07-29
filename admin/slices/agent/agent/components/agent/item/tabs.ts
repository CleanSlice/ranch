export const AGENT_TABS = [
  { value: 'chat', title: 'Chat', desc: 'Talk to the agent.' },
  { value: 'overview', title: 'Overview', desc: 'Usage, runtime, visibility & embed.' },
  { value: 'knowledge', title: 'Knowledge', desc: 'Knowledge bases the agent can query.' },
  { value: 'files', title: 'Files', desc: 'Browse and edit S3-stored agent data.' },
  { value: 'secrets', title: 'Secrets', desc: 'User-scoped secrets the runtime stores.' },
  { value: 'env', title: 'Environment', desc: 'Env vars injected at deploy time.' },
  { value: 'channels', title: 'Channels', desc: 'Messaging platforms (Telegram, …) the agent talks on.' },
  { value: 'chats', title: 'Chats', desc: 'Conversation history across channels.' },
  { value: 'paddock', title: 'Paddock', desc: 'Run evaluations & manage scenarios.' },
] as const;

export type AgentTab = (typeof AGENT_TABS)[number]['value'];
