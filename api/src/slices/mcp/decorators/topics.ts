/**
 * The accordions of the chat's Tools panel (CLEAN-109). Every `@Tool` names
 * exactly one topic; the panel groups by it and orders groups by `order`.
 * Topics mirror admin-console sections, merged where a section would hold
 * fewer than three tools. Add a topic here before adding a tool to it — the
 * registry refuses an unknown topic at boot.
 */
export const ToolTopics = {
  Agents: 'agents',
  AgentWorkspace: 'agent_workspace',
  Templates: 'templates',
  Skills: 'skills',
  Llm: 'llm',
  McpServers: 'mcp_servers',
  Knowledge: 'knowledge',
  Settings: 'settings',
  Peers: 'peers',
  Paddock: 'paddock',
  UsersKeys: 'users_keys',
  ChatsUsage: 'chats_usage',
  Browser: 'browser',
  Attachments: 'attachments',
  Platform: 'platform',
} as const;

export type ToolTopic = (typeof ToolTopics)[keyof typeof ToolTopics];

export interface IToolTopicInfo {
  key: ToolTopic;
  title: string;
  order: number;
}

export const TOOL_TOPIC_INFO: Record<ToolTopic, IToolTopicInfo> = {
  agents: { key: 'agents', title: 'Agents', order: 10 },
  agent_workspace: { key: 'agent_workspace', title: 'Agent workspace', order: 20 },
  templates: { key: 'templates', title: 'Templates', order: 30 },
  skills: { key: 'skills', title: 'Skills', order: 40 },
  llm: { key: 'llm', title: 'LLM credentials', order: 50 },
  mcp_servers: { key: 'mcp_servers', title: 'MCP servers', order: 60 },
  knowledge: { key: 'knowledge', title: 'Knowledge', order: 70 },
  settings: { key: 'settings', title: 'Settings', order: 80 },
  peers: { key: 'peers', title: 'Peers (A2A)', order: 90 },
  paddock: { key: 'paddock', title: 'Paddock', order: 100 },
  users_keys: { key: 'users_keys', title: 'Users & API keys', order: 110 },
  chats_usage: { key: 'chats_usage', title: 'Chats & usage', order: 120 },
  browser: { key: 'browser', title: 'Browser & integrations', order: 130 },
  attachments: { key: 'attachments', title: 'Attachments', order: 140 },
  platform: { key: 'platform', title: 'Platform', order: 150 },
};

export const TOOL_TOPIC_KEYS: readonly ToolTopic[] = Object.values(ToolTopics);

export function isToolTopic(value: unknown): value is ToolTopic {
  return (
    typeof value === 'string' && (TOOL_TOPIC_KEYS as string[]).includes(value)
  );
}

/** Topics in panel order. */
export function orderedTopics(): IToolTopicInfo[] {
  return [...TOOL_TOPIC_KEYS]
    .map((key) => TOOL_TOPIC_INFO[key])
    .sort((a, b) => a.order - b.order);
}
