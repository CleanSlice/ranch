import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  A2A_VERSION,
  A2A_VERSION_HEADER,
  A2aMethods,
  type IA2aAgentCard,
  type IA2aSendMessageParams,
  type IA2aTask,
  type IJsonRpcResponse,
} from './a2a.types';
import {
  DelegationError,
  DelegationErrorCodes,
  PeerCardUnreachableError,
} from './peer.types';

/** A card read is a small GET; ten seconds is generous and bounds a hung peer. */
const CARD_TIMEOUT_MS = 10_000;

/** Headroom over the peer's own wait, so its stated timeout wins the race. */
const CLIENT_TIMEOUT_MARGIN_MS = 5_000;

/** Enough of a failing body to diagnose, not enough to flood a log line. */
const BODY_EXCERPT_CHARS = 200;

/**
 * The outbound half of A2A (CLEAN-74): reading a peer's card and handing it a
 * task. Every failure is translated into a code the caller can turn into
 * product wording — a delegating agent must be able to tell the person *why*
 * it came back empty-handed, and "TypeError: fetch failed" is not that.
 */
@Injectable()
export class A2aClient {
  private readonly logger = new Logger(A2aClient.name);

  /**
   * Reads a card at connect and refresh time. Validated beyond "it parsed":
   * a snapshot missing skills or an interface is useless later, and failing
   * now names the problem while an operator is still looking at the screen.
   */
  async fetchCard(cardUrl: string, token: string): Promise<IA2aAgentCard> {
    let response: Response;
    try {
      response = await fetch(cardUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(CARD_TIMEOUT_MS),
      });
    } catch (err) {
      throw new PeerCardUnreachableError(
        `Could not reach the card at ${cardUrl}: ${describe(err)}`,
      );
    }

    if (!response.ok) {
      const body = await excerpt(response);
      throw new PeerCardUnreachableError(
        `The card at ${cardUrl} answered ${response.status}${body ? `: ${body}` : ''}`,
        response.status,
      );
    }

    let card: unknown;
    try {
      card = await response.json();
    } catch {
      throw new PeerCardUnreachableError(
        `The card at ${cardUrl} is not valid JSON`,
        response.status,
      );
    }

    if (!isCard(card)) {
      throw new PeerCardUnreachableError(
        `The document at ${cardUrl} is not an agent card`,
        response.status,
      );
    }

    return card;
  }

  /**
   * Hands a task to a peer and waits for the finished task.
   *
   * A peer that answers with a message instead of a task is treated as an
   * error: this client asked for blocking work and has nothing to poll with,
   * so a message would leave the delegation with no outcome to report.
   */
  async sendMessage(
    interfaceUrl: string,
    token: string,
    params: IA2aSendMessageParams,
    timeoutMs: number,
  ): Promise<IA2aTask> {
    let response: Response;
    try {
      response = await fetch(interfaceUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          [A2A_VERSION_HEADER]: A2A_VERSION,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: crypto.randomUUID(),
          method: A2aMethods.SendMessage,
          params,
        }),
        signal: AbortSignal.timeout(timeoutMs + CLIENT_TIMEOUT_MARGIN_MS),
      });
    } catch (err) {
      throw new DelegationError(
        DelegationErrorCodes.Unreachable,
        `could not be reached: ${describe(err)}`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new DelegationError(
        DelegationErrorCodes.Unauthorized,
        'refused this credential — the connection may have been removed',
      );
    }

    if (!response.ok) {
      const body = await excerpt(response);
      throw new DelegationError(
        DelegationErrorCodes.Unreachable,
        `answered ${response.status}${body ? `: ${body}` : ''}`,
      );
    }

    let payload: IJsonRpcResponse;
    try {
      payload = (await response.json()) as IJsonRpcResponse;
    } catch {
      throw new DelegationError(
        DelegationErrorCodes.Error,
        'answered with something that is not JSON',
      );
    }

    if (payload.error) {
      throw new DelegationError(
        DelegationErrorCodes.Error,
        payload.error.message || `protocol error ${payload.error.code}`,
      );
    }

    const task = (payload.result as { task?: IA2aTask } | undefined)?.task;
    if (!task?.status) {
      throw new DelegationError(
        DelegationErrorCodes.Error,
        'answered without a task',
      );
    }

    return task;
  }
}

function isCard(value: unknown): value is IA2aAgentCard {
  if (!value || typeof value !== 'object') return false;
  const card = value as Record<string, unknown>;
  return (
    typeof card.name === 'string' &&
    Array.isArray(card.skills) &&
    Array.isArray(card.supportedInterfaces) &&
    card.supportedInterfaces.length > 0
  );
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    // AbortSignal.timeout rejects with TimeoutError; "aborted" alone reads as
    // if somebody cancelled it.
    if (err.name === 'TimeoutError') return 'it did not answer in time';
    return err.message;
  }
  return String(err);
}

async function excerpt(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, BODY_EXCERPT_CHARS).trim();
  } catch {
    return '';
  }
}
