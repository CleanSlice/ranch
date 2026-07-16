import type { TranscriptMessage } from '#/agent/file/domain';
import { IChatSessionData } from './chat.types';

export type ChatExportFormat = 'json' | 'markdown' | 'csv';

export interface ExportedChat {
  body: string;
  contentType: string;
  ext: string;
}

/** Render a chat transcript for download. Pure — the controller streams it. */
export function formatChatExport(
  format: ChatExportFormat,
  session: IChatSessionData,
  messages: TranscriptMessage[],
): ExportedChat {
  switch (format) {
    case 'markdown':
      return {
        body: toMarkdown(session, messages),
        contentType: 'text/markdown; charset=utf-8',
        ext: 'md',
      };
    case 'csv':
      return {
        body: toCsv(messages),
        contentType: 'text/csv; charset=utf-8',
        ext: 'csv',
      };
    default:
      return {
        body: toJson(session, messages),
        contentType: 'application/json; charset=utf-8',
        ext: 'json',
      };
  }
}

function who(s: IChatSessionData): string {
  return s.title || s.externalUserId || '—';
}

function iso(ts: number): string {
  return new Date(ts).toISOString();
}

function toJson(s: IChatSessionData, messages: TranscriptMessage[]): string {
  return JSON.stringify(
    {
      chat: {
        id: s.id,
        agentId: s.agentId,
        channel: s.channel,
        externalUserId: s.externalUserId,
        sessionKey: s.sessionKey,
        messageCount: s.messageCount,
        userMessageCount: s.userMessageCount,
        lastMessageAt: s.lastMessageAt,
        summary: s.summary,
        insights: s.insights,
      },
      messages,
    },
    null,
    2,
  );
}

function toMarkdown(
  s: IChatSessionData,
  messages: TranscriptMessage[],
): string {
  const head = [
    `# Chat — ${who(s)} (${s.channel})`,
    '',
    `- Session: \`${s.sessionKey}\``,
    `- Messages: ${s.messageCount} (${s.userMessageCount} from user)`,
    `- Last activity: ${s.lastMessageAt.toISOString()}`,
  ];
  if (s.summary) head.push('', '## Summary', '', s.summary);
  head.push('', '## Transcript', '');

  const body = messages.map((m) => {
    const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
    return `**${role}** · ${iso(m.ts)}\n\n${m.text}\n`;
  });
  return head.join('\n') + '\n' + body.join('\n---\n\n') + '\n';
}

function csvCell(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

function toCsv(messages: TranscriptMessage[]): string {
  const rows = ['id,role,ts,datetime,text'];
  for (const m of messages) {
    rows.push(
      [
        csvCell(m.id),
        csvCell(m.role),
        String(m.ts),
        csvCell(iso(m.ts)),
        csvCell(m.text),
      ].join(','),
    );
  }
  return rows.join('\n') + '\n';
}
