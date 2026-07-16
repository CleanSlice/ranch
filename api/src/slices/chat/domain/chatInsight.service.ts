import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ILlmGateway, anthropicAuthHeaders } from '#/llm/domain';
import type { ILlmCredentialData } from '#/llm/domain';
import { TranscriptReaderService } from '#/agent/file/domain';
import { IChatGateway } from './chat.gateway';
import {
  ChatSentiment,
  IChatInsightBatchResult,
  IChatInsightGate,
  IChatInsights,
  IChatSessionData,
} from './chat.types';

const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-6';
const TRANSCRIPT_CAP = 12_000; // chars — tail-truncate long chats (v1)
const SENTIMENTS: ChatSentiment[] = [
  'positive',
  'neutral',
  'negative',
  'mixed',
];

/**
 * Generates an LLM summary + structured insights per chat and stores them on
 * the ChatSession. Runs on demand (`POST /chats/:id/summarize`) and, if
 * `CHAT_INSIGHT_INTERVAL_SEC` is set, as a gated cron-batch (never summarizes
 * empty or unchanged chats — see IChatInsightGate). Same setInterval pattern as
 * ChatSyncService (ranch has no scheduler facility).
 */
@Injectable()
export class ChatInsightService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatInsightService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  private readonly gate: IChatInsightGate = {
    cooldownMs: 60 * 60 * 1000, // 1h settled
    minUserMessages: 3,
    limit: 25, // per-run cap bounds token spend
  };

  constructor(
    private readonly chats: IChatGateway,
    private readonly reader: TranscriptReaderService,
    private readonly llms: ILlmGateway,
  ) {}

  onModuleInit(): void {
    const sec = Number(process.env.CHAT_INSIGHT_INTERVAL_SEC ?? 0);
    if (!Number.isFinite(sec) || sec <= 0) return;
    this.logger.log(`chat insight batch enabled: every ${sec}s`);
    this.timer = setInterval(() => {
      void this.runBatch().catch((err) =>
        this.logger.error(`insight batch failed: ${(err as Error).message}`),
      );
    }, sec * 1000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** On-demand summarize (admin button). Returns the updated session. */
  async summarize(id: string): Promise<IChatSessionData> {
    const session = await this.chats.findById(id);
    if (!session) throw new NotFoundException(`Chat ${id} not found`);
    const credential = await this.pickCredential();
    if (!credential) {
      throw new BadRequestException(
        'No active Anthropic LLM credential — add one in Settings → LLM credentials.',
      );
    }
    await this.summarizeSession(session, credential);
    return (await this.chats.findById(id)) ?? session;
  }

  /** Gated cron-batch. Skips entirely when no Anthropic credential exists. */
  async runBatch(): Promise<IChatInsightBatchResult> {
    const empty: IChatInsightBatchResult = {
      eligible: 0,
      summarized: 0,
      failed: 0,
    };
    if (this.running) {
      this.logger.warn('insight batch already running — skipping');
      return empty;
    }
    const credential = await this.pickCredential();
    if (!credential) {
      this.logger.debug('insight batch: no Anthropic credential — skipping');
      return empty;
    }

    this.running = true;
    const result = { ...empty };
    try {
      const sessions = await this.chats.findEligibleForInsight(this.gate);
      result.eligible = sessions.length;
      for (const session of sessions) {
        try {
          await this.summarizeSession(session, credential);
          result.summarized++;
        } catch (err) {
          result.failed++;
          // A rejected credential (401/403 → BadRequestException) dooms every
          // session — abort the batch instead of hammering the LLM with a bad key.
          if (err instanceof BadRequestException) {
            this.logger.error(
              `insight batch aborted — ${(err as Error).message}`,
            );
            break;
          }
          this.logger.warn(
            `insight failed for ${session.id}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
    this.logger.log(
      `insight batch: eligible=${result.eligible} summarized=${result.summarized} failed=${result.failed}`,
    );
    return result;
  }

  private async summarizeSession(
    session: IChatSessionData,
    credential: ILlmCredentialData,
  ): Promise<void> {
    const transcript = await this.loadTranscript(session);
    if (!transcript.trim()) return; // nothing to summarize (e.g. file gone)

    const raw = await this.callClaude(
      credential.apiKey,
      credential.model || ANTHROPIC_DEFAULT_MODEL,
      buildInsightPrompt(transcript),
    );
    const parsed = parseInsights(raw);
    if (!parsed) {
      throw new Error(
        `insight generator returned no valid JSON: ${raw.slice(0, 200)}`,
      );
    }
    const { summary, ...insights } = parsed;
    await this.chats.saveInsights(session.id, summary, insights);
  }

  private async loadTranscript(session: IChatSessionData): Promise<string> {
    const path = `data/sessions/${session.sessionKey}.jsonl`;
    let messages;
    try {
      messages = await this.reader.read(session.agentId, path, {
        types: ['user', 'assistant'],
        filterTransient: true,
      });
    } catch {
      return '';
    }
    let text = messages.map((m) => `${m.role}: ${m.text}`).join('\n');
    if (text.length > TRANSCRIPT_CAP) {
      text = `…(earlier messages truncated)…\n${text.slice(-TRANSCRIPT_CAP)}`;
    }
    return text;
  }

  private async pickCredential(): Promise<ILlmCredentialData | null> {
    const active = await this.llms.findActive();
    return (
      active.find((c) => {
        const p = c.provider.toLowerCase();
        return p === 'claude' || p === 'anthropic';
      }) ?? null
    );
  }

  private async callClaude(
    apiKey: string,
    model: string,
    prompt: string,
  ): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        // OAuth subscription tokens (sk-ant-oat…, what the bots run on) must go
        // as Bearer + claude-code beta, not x-api-key — see anthropicAuthHeaders.
        ...anthropicAuthHeaders(apiKey),
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new BadRequestException(
          `Anthropic rejected the API key (${res.status}) — update the Anthropic credential in Settings → LLM credentials.`,
        );
      }
      throw new BadGatewayException(
        `Anthropic API ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    return (json.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n')
      .trim();
  }
}

export function buildInsightPrompt(transcript: string): string {
  return `You are analyzing a conversation between a user (the human) and an AI assistant (the agent). Produce a concise summary and structured insights.

Conversation:
"""
${transcript}
"""

Output ONLY a JSON object — no markdown fences, no commentary — shaped exactly like:
{
  "summary": "2-4 sentence third-person recap: what the user wanted and what happened",
  "topics": ["short", "topic", "tags"],
  "sentiment": "positive" | "neutral" | "negative" | "mixed",
  "resolved": true,
  "language": "ISO 639-1 code of the user's language, e.g. en, ru"
}`;
}

export interface ParsedInsight extends IChatInsights {
  summary: string;
}

/** Tolerant parse of the LLM's JSON output. Returns null if unusable. */
export function parseInsights(raw: string): ParsedInsight | null {
  const match = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .match(/\{[\s\S]*\}/);
  if (!match) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof obj.summary !== 'string' || !obj.summary.trim()) return null;
  const sentiment = obj.sentiment as ChatSentiment;
  return {
    summary: obj.summary,
    topics: Array.isArray(obj.topics)
      ? obj.topics
          .filter((t): t is string => typeof t === 'string')
          .slice(0, 12)
      : [],
    sentiment: SENTIMENTS.includes(sentiment) ? sentiment : 'neutral',
    resolved: typeof obj.resolved === 'boolean' ? obj.resolved : false,
    language: typeof obj.language === 'string' ? obj.language : 'en',
  };
}
