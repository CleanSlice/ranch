import { Injectable } from '@nestjs/common';
import { NOTIFY_TIMEOUT_MS } from '../domain/agentEvent.types';
import {
  INotificationMessage,
  INotifier,
  NotifyResultTypes,
} from '../domain/notifier';

// What Slack answers when the address itself is the problem: a malformed
// payload aside, these mean "this webhook is wrong, revoked or gone" — no
// number of retries fixes that.
const PERMANENT_STATUSES = new Set([400, 403, 404, 410]);

const ERROR_BODY_MAX = 300;

/**
 * A Slack incoming webhook: one POST of `{ text, blocks }` to a secret
 * address. The address never appears in what this returns — the result is
 * stored on the notification row and shown in the console.
 */
@Injectable()
export class SlackWebhookNotifier extends INotifier {
  async send(
    address: string,
    message: INotificationMessage,
  ): Promise<NotifyResultTypes> {
    let response: Response;
    try {
      response = await fetch(address, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      });
    } catch (err) {
      // A fixed sentence on purpose: a fetch error's own message can carry
      // the URL it failed on.
      const timedOut = (err as Error)?.name === 'TimeoutError';
      return {
        ok: false,
        retryable: true,
        error: timedOut
          ? `Slack did not answer within ${NOTIFY_TIMEOUT_MS / 1000} s`
          : 'could not reach Slack',
      };
    }

    if (response.ok) return { ok: true };

    const body = (await response.text().catch(() => ''))
      .split(address)
      .join('[address]')
      .slice(0, ERROR_BODY_MAX)
      .trim();
    const error = `Slack answered ${response.status}${body ? `: ${body}` : ''}`;

    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      return {
        ok: false,
        retryable: true,
        ...(Number.isFinite(seconds) &&
          seconds > 0 && { retryAfterMs: seconds * 1000 }),
        error,
      };
    }
    return {
      ok: false,
      retryable: !PERMANENT_STATUSES.has(response.status),
      error,
    };
  }
}
