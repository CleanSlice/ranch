import { Injectable } from '@nestjs/common';
import {
  NOTIFY_TIMEOUT_MS,
  SlackReactionTypes,
} from '../domain/agentEvent.types';
import {
  INotificationMessage,
  ISlackBotCredentials,
  ISlackBotNotifier,
  NotifyResultTypes,
  PostResultTypes,
} from '../domain/notifier';

const SLACK_API = 'https://slack.com/api';
const ERROR_BODY_MAX = 300;

/**
 * What Slack's `error` means for us (research D10). Anything not listed
 * fails the delivery without a retry and is shown as Slack said it.
 */
const PERMANENT: Record<string, string> = {
  invalid_auth: 'The bot token is not valid — paste a new one',
  not_authed: 'The bot token is not valid — paste a new one',
  token_revoked: 'The bot token was revoked — paste a new one',
  account_inactive: 'The bot token belongs to a deactivated app',
  channel_not_found: 'No channel with this id',
  not_in_channel:
    'The bot is not in the channel — invite it (/invite @<the bot>)',
  is_archived: 'The channel is archived',
};

// Side effects of a rewrite or a reaction: the message is gone or too old
// to edit. The delivery they rode on still counts as sent (FR-020).
const SIDE_EFFECT_LOST = new Set([
  'message_not_found',
  'cant_update_message',
  'edit_window_closed',
]);

// A reaction that is already there, or was not there to remove, is the
// state we wanted.
const REACTION_SETTLED = new Set(['already_reacted', 'no_reaction']);

type SlackAnswer = {
  ok: boolean;
  error?: string;
  needed?: string;
  ts?: string;
};

type CallResult =
  | { ok: true; answer: SlackAnswer }
  | Extract<NotifyResultTypes, { ok: false }>;

/**
 * The bot transport over Slack's Web API (CLEAN-165). Four methods, one
 * shape of answer, called with `fetch` like the webhook notifier — no SDK.
 * The token is a secret: it goes in the header and is scrubbed from any
 * body this class quotes in an error.
 */
@Injectable()
export class SlackBotNotifier extends ISlackBotNotifier {
  async post(
    cred: ISlackBotCredentials,
    message: INotificationMessage,
    threadTs?: string,
  ): Promise<PostResultTypes> {
    const result = await this.call(cred, 'chat.postMessage', {
      channel: cred.channelId,
      text: message.text,
      blocks: message.blocks,
      unfurl_links: false,
      ...(threadTs && { thread_ts: threadTs }),
    });
    if (!result.ok) return result;
    const ts = result.answer.ts;
    if (!ts) {
      return {
        ok: false,
        retryable: false,
        error: 'Slack accepted the message but gave it no id',
      };
    }
    return { ok: true, ts };
  }

  async update(
    cred: ISlackBotCredentials,
    ts: string,
    message: INotificationMessage,
  ): Promise<NotifyResultTypes> {
    const result = await this.call(cred, 'chat.update', {
      channel: cred.channelId,
      ts,
      text: message.text,
      blocks: message.blocks,
    });
    return result.ok ? { ok: true } : result;
  }

  async setReaction(
    cred: ISlackBotCredentials,
    ts: string,
    name: SlackReactionTypes,
    previous: SlackReactionTypes | null,
  ): Promise<NotifyResultTypes> {
    if (previous && previous !== name) {
      const removed = await this.call(cred, 'reactions.remove', {
        channel: cred.channelId,
        timestamp: ts,
        name: previous,
      });
      if (!removed.ok && !removed.settled) return removed;
    }
    const added = await this.call(cred, 'reactions.add', {
      channel: cred.channelId,
      timestamp: ts,
      name,
    });
    return added.ok || added.settled ? { ok: true } : added;
  }

  private async call(
    cred: ISlackBotCredentials,
    method: string,
    body: Record<string, unknown>,
  ): Promise<CallResult & { settled?: boolean }> {
    let response: Response;
    try {
      response = await fetch(`${SLACK_API}/${method}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${cred.token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = (err as Error)?.name === 'TimeoutError';
      return {
        ok: false,
        retryable: true,
        error: timedOut
          ? `Slack did not answer within ${NOTIFY_TIMEOUT_MS / 1000} s`
          : 'could not reach Slack',
      };
    }

    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      return {
        ok: false,
        retryable: true,
        ...(Number.isFinite(seconds) &&
          seconds > 0 && { retryAfterMs: seconds * 1000 }),
        error: 'Slack answered 429',
      };
    }

    const raw = await response.text().catch(() => '');
    let answer: SlackAnswer | null = null;
    try {
      answer = JSON.parse(raw) as SlackAnswer;
    } catch {
      answer = null;
    }
    if (!response.ok || !answer) {
      return {
        ok: false,
        // Slack's 5xx come and go; a 4xx that is not JSON is not ours to fix.
        retryable: response.status >= 500,
        error: `Slack answered ${response.status}: ${this.scrub(raw, cred.token)}`,
      };
    }
    if (answer.ok) return { ok: true, answer };

    const code = answer.error ?? 'unknown_error';
    if (code === 'ratelimited') {
      return {
        ok: false,
        retryable: true,
        error: 'Slack answered ratelimited',
      };
    }
    if (REACTION_SETTLED.has(code)) {
      return { ok: false, retryable: false, error: code, settled: true };
    }
    if (SIDE_EFFECT_LOST.has(code)) {
      return {
        ok: false,
        retryable: false,
        error: `Could not update the incident message: ${code}`,
      };
    }
    if (code === 'missing_scope') {
      return {
        ok: false,
        retryable: false,
        error: `The bot lacks a permission: ${this.scrub(answer.needed ?? '?', cred.token)}`,
      };
    }
    const known = PERMANENT[code];
    return {
      ok: false,
      retryable: false,
      error: known ?? `Slack answered: ${this.scrub(code, cred.token)}`,
    };
  }

  /** Never the token, never a wall of text. */
  private scrub(text: string, token: string): string {
    return text.split(token).join('[token]').slice(0, ERROR_BODY_MAX).trim();
  }
}
