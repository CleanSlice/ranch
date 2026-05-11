import { Injectable, Logger } from '@nestjs/common';
import { ILlmCredentialData } from '../domain/llm.types';
import {
  ILlmHealthGateway,
  ILlmHealthCheckResult,
} from '../domain/llmHealth.gateway';

const PING_PROMPT = 'ping';
const TIMEOUT_MS = 15_000;

@Injectable()
export class LlmHealthGateway extends ILlmHealthGateway {
  private readonly logger = new Logger(LlmHealthGateway.name);

  async check(credential: ILlmCredentialData): Promise<ILlmHealthCheckResult> {
    const provider = credential.provider.toLowerCase();
    const started = Date.now();

    try {
      if (provider === 'anthropic' || provider === 'claude') {
        await this.checkAnthropic(credential.apiKey, credential.model);
      } else if (provider === 'openai') {
        await this.checkOpenAI(credential.apiKey, credential.model);
      } else if (provider === 'gemini' || provider === 'google') {
        await this.checkGemini(credential.apiKey, credential.model);
      } else {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          provider: credential.provider,
          model: credential.model,
          error: `Unsupported provider "${credential.provider}"`,
        };
      }

      return {
        ok: true,
        latencyMs: Date.now() - started,
        provider: credential.provider,
        model: credential.model,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `LLM health-check failed for ${credential.provider}/${credential.model}: ${message}`,
      );
      return {
        ok: false,
        latencyMs: Date.now() - started,
        provider: credential.provider,
        model: credential.model,
        error: message.slice(0, 300),
      };
    }
  }

  private async checkAnthropic(apiKey: string, model: string): Promise<void> {
    const res = await fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: PING_PROMPT }],
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
    }
  }

  private async checkOpenAI(apiKey: string, model: string): Promise<void> {
    const res = await fetchWithTimeout(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: PING_PROMPT }],
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
    }
  }

  private async checkGemini(apiKey: string, model: string): Promise<void> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PING_PROMPT }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
    }
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
