import { formatChatExport } from './chatExport';
import { IChatSessionData } from './chat.types';
import type { TranscriptMessage } from '#/agent/file/domain';

const SESSION: IChatSessionData = {
  id: 'c1',
  agentId: 'a1',
  channel: 'bridle',
  externalUserId: 'admin',
  sessionKey: 'bridle:admin',
  title: null,
  preview: null,
  lastRole: 'assistant',
  lastMessageAt: new Date('2026-07-16T10:00:00.000Z'),
  messageCount: 2,
  userMessageCount: 1,
  lastIndexedEventId: null,
  lastIndexedSize: 0,
  summary: 'User asked about billing.',
  summaryAt: new Date(0),
  insights: null,
  archived: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const MESSAGES: TranscriptMessage[] = [
  { id: 'm1', role: 'user', text: 'hello, "quoted"', ts: 1000 },
  { id: 'm2', role: 'assistant', text: 'hi there', ts: 2000 },
];

describe('formatChatExport', () => {
  it('json → parseable object with chat + messages', () => {
    const out = formatChatExport('json', SESSION, MESSAGES);
    expect(out.ext).toBe('json');
    expect(out.contentType).toContain('application/json');
    const parsed = JSON.parse(out.body) as {
      chat: { id: string; summary: string };
      messages: TranscriptMessage[];
    };
    expect(parsed.chat.id).toBe('c1');
    expect(parsed.chat.summary).toBe('User asked about billing.');
    expect(parsed.messages).toHaveLength(2);
  });

  it('markdown → header, summary, and transcript', () => {
    const out = formatChatExport('markdown', SESSION, MESSAGES);
    expect(out.ext).toBe('md');
    expect(out.body).toContain('# Chat — admin (bridle)');
    expect(out.body).toContain('## Summary');
    expect(out.body).toContain('User asked about billing.');
    expect(out.body).toContain('**User**');
    expect(out.body).toContain('**Assistant**');
    expect(out.body).toContain('hi there');
  });

  it('csv → header + CSV-escaped rows (quotes doubled)', () => {
    const out = formatChatExport('csv', SESSION, MESSAGES);
    expect(out.ext).toBe('csv');
    const lines = out.body.trim().split('\n');
    expect(lines[0]).toBe('id,role,ts,datetime,text,attachments');
    expect(lines[1]).toContain('"hello, ""quoted"""'); // embedded quote escaped
    expect(lines[1]).toContain('"user"');
  });

  describe('messages with attachments', () => {
    const AGENT_TEXT =
      'распарси\n\n[Attached file: invoice.xlsx — id: x1]\n```\nR1: A=1\n```';
    const WITH_FILES: TranscriptMessage[] = [
      {
        id: 'm1',
        role: 'user',
        text: 'распарси',
        ts: 1000,
        attachments: [
          {
            id: 'x1',
            name: 'invoice.xlsx',
            mimeType:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: 2048,
            kind: 'binary',
          },
          {
            id: 'x2',
            name: 'photo.png',
            mimeType: 'image/png',
            size: 500,
            kind: 'image',
          },
        ],
        agentText: AGENT_TEXT,
      },
      { id: 'm2', role: 'assistant', text: 'done', ts: 2000 },
    ];

    it('markdown → typed text then one line per attachment, never the dump', () => {
      const out = formatChatExport('markdown', SESSION, WITH_FILES);
      expect(out.body).toContain(
        'распарси\n📎 invoice.xlsx (2.0 KB)\n📎 photo.png (500 B)',
      );
      expect(out.body).not.toContain('[Attached file:');
      expect(out.body).not.toContain('R1: A=1');
    });

    it('csv → attachments column with names joined by "; "', () => {
      const out = formatChatExport('csv', SESSION, WITH_FILES);
      const lines = out.body.trim().split('\n');
      expect(lines[1]).toContain('"распарси","invoice.xlsx; photo.png"');
      expect(lines[1]).not.toContain('[Attached file:');
      expect(lines[2].endsWith(',""')).toBe(true);
    });

    it('json → keeps attachments and agentText as-is', () => {
      const out = formatChatExport('json', SESSION, WITH_FILES);
      const parsed = JSON.parse(out.body) as { messages: TranscriptMessage[] };
      expect(parsed.messages[0].attachments).toHaveLength(2);
      expect(parsed.messages[0].agentText).toBe(AGENT_TEXT);
      expect(parsed.messages[0].text).toBe('распарси');
    });
  });
});
