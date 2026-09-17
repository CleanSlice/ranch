import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as dns from 'dns/promises';
import * as net from 'net';
import {
  A2A_VERSION,
  A2A_VERSION_HEADER,
  A2aMethods,
  type A2aSendMessageResult,
  type IA2aAgentCard,
  type IA2aMessage,
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

/** A failed RPC body is read further than an excerpt: a JSON-RPC error
 *  envelope must parse whole to be recognised as one. */
const FAILED_RPC_BODY_CHARS = 8_000;

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
  async fetchCard(cardUrl: string, token?: string): Promise<IA2aAgentCard> {
    let response: Response;
    try {
      response = await fetch(cardUrl, {
        headers: {
          // External agents may serve their card openly (CLEAN-95): no
          // credential means no Authorization header, not an empty one.
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Accept: 'application/json',
        },
        // A redirect would let a vetted public URL bounce the request onto a
        // private address AFTER the SSRF guard ran, so none is followed.
        // 'manual' rather than 'error' keeps the 3xx and its Location, so the
        // operator is told which address to paste instead of "fetch failed"
        // (CLEAN-97). The target is never requested either way.
        redirect: 'manual',
        signal: AbortSignal.timeout(CARD_TIMEOUT_MS),
      });
    } catch (err) {
      throw new PeerCardUnreachableError(
        `Could not reach the card at ${cardUrl}: ${describe(err)}`,
      );
    }

    const redirect = redirectTarget(response);
    if (redirect !== null) {
      throw new PeerCardUnreachableError(
        `The card at ${cardUrl} redirects${redirect ? ` to ${redirect}` : ''}. ` +
          'Redirects are not followed — import the final address instead.',
        response.status,
        'invalid',
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
        'invalid',
      );
    }

    if (!isCard(card)) {
      // A 0.3 card is a real card in the wrong dialect: it names its version
      // at the top level and has no supportedInterfaces. Saying "not a card"
      // there sends the operator hunting for a broken URL (CLEAN-97).
      const legacyVersion = legacyProtocolVersion(card);
      if (legacyVersion) {
        throw new PeerCardUnreachableError(
          `This agent speaks A2A ${legacyVersion}; only ${A2A_VERSION} is supported`,
          response.status,
          'version',
        );
      }
      throw new PeerCardUnreachableError(
        `The document at ${cardUrl} is not an agent card`,
        response.status,
        'invalid',
      );
    }

    return card;
  }

  /**
   * Hands a task to a peer and waits for its reply.
   *
   * SECURITY NOTE. `interfaceUrl` comes from a stored card snapshot, and a
   * card is remote content. For internal rows every snapshot was read from
   * this API's own route — the URL is ours. External rows (CLEAN-95) are
   * exactly the foreseen case: import vets the card's interface URL before
   * anything is saved (CLEAN-97), and delegation re-checks it with
   * `assertPublicPeerAddress` / `assertResolvesPublic` before any request
   * goes out. DNS rebinding between the check and the connect is accepted as
   * out of scope.
   *
   * The spec lets a peer answer a blocking SendMessage with either a task or
   * a plain message, and most public agents choose the message for a direct
   * reply. Both are returned as-is; reading the answer out of them is the
   * caller's job (CLEAN-97).
   */
  async sendMessage(
    interfaceUrl: string,
    token: string | undefined,
    params: IA2aSendMessageParams,
    timeoutMs: number,
  ): Promise<A2aSendMessageResult> {
    let response: Response;
    try {
      response = await fetch(interfaceUrl, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
          [A2A_VERSION_HEADER]: A2A_VERSION,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: crypto.randomUUID(),
          method: A2aMethods.SendMessage,
          params,
        }),
        // Same reason as fetchCard: a redirect is an SSRF-guard bypass, so it
        // is reported, never followed.
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs + CLIENT_TIMEOUT_MARGIN_MS),
      });
    } catch (err) {
      throw new DelegationError(
        DelegationErrorCodes.Unreachable,
        `could not be reached: ${describe(err)}`,
      );
    }

    const redirect = redirectTarget(response);
    if (redirect !== null) {
      throw new DelegationError(
        DelegationErrorCodes.Unreachable,
        `redirects${redirect ? ` to ${redirect}` : ''}, and redirects are not followed`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new DelegationError(
        DelegationErrorCodes.Unauthorized,
        'refused this credential — the connection may have been removed',
      );
    }

    if (!response.ok) {
      const body = await excerpt(response, FAILED_RPC_BODY_CHARS);
      // Some servers send a JSON-RPC error with a 4xx status. The peer was
      // reached and said why it refused; "could not be reached" would send
      // the operator after the network instead of the request (CLEAN-97).
      const rpcError = jsonRpcErrorMessage(body);
      if (rpcError) {
        throw new DelegationError(DelegationErrorCodes.Error, rpcError);
      }
      throw new DelegationError(
        DelegationErrorCodes.Unreachable,
        `answered ${response.status}${body ? `: ${body.slice(0, BODY_EXCERPT_CHARS)}` : ''}`,
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

    const result = payload.result as
      | { task?: IA2aTask; message?: IA2aMessage }
      | undefined;

    if (result?.task?.status) return { task: result.task };
    if (result?.message && Array.isArray(result.message.parts)) {
      return { message: result.message };
    }

    throw new DelegationError(
      DelegationErrorCodes.Error,
      'answered with neither a task nor a message',
    );
  }
}

/** The version a pre-1.0 card declares at its top level, when it looks like one. */
function legacyProtocolVersion(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const card = value as Record<string, unknown>;
  if (Array.isArray(card.supportedInterfaces)) return null;
  return typeof card.protocolVersion === 'string' &&
    typeof card.name === 'string'
    ? card.protocolVersion
    : null;
}

/**
 * SSRF guard for operator-supplied peer addresses (CLEAN-95). External card
 * URLs and the interface URLs inside fetched cards are remote content, so a
 * request to them must never be allowed to reach loopback, RFC1918 ranges or
 * the cloud metadata endpoint.
 *
 * Layers: (1) this literal check — private names, IP literals in any
 * spelling (IPv6 accepts global unicast 2000::/3 only, which also refuses
 * `::ffff:` mapped v4 and unabbreviated loopback; curl-style numeric
 * shorthand like `2130706433` or `0x7f000001` is refused outright);
 * (2) `assertResolvesPublic` below, a pre-flight DNS check for hostnames;
 * (3) no redirect is ever followed (`redirect: 'manual'`, reported as a
 * refusal with its target). Residual risk, accepted
 * and documented: the connection itself may re-resolve (DNS rebinding
 * TOCTOU). `A2A_ALLOW_PRIVATE_PEERS=true` lifts the guard for local
 * development, where the mock peer IS loopback.
 */
export function assertPublicPeerAddress(rawUrl: string): void {
  if (process.env.A2A_ALLOW_PRIVATE_PEERS === 'true') return;

  const host = hostOf(rawUrl);

  const privateName =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal');

  if (privateName || isPrivateIpLiteral(host) || isNumericShorthand(host)) {
    throw new PeerCardUnreachableError(
      `The address ${host} is a private or local host — external peers must be publicly reachable`,
      undefined,
      'invalid',
    );
  }
}

/**
 * Second SSRF layer: a public-looking hostname may resolve to a private
 * address. Resolution FAILURE passes — the fetch that follows will report it
 * honestly — but a resolved private address refuses before any request.
 */
export async function assertResolvesPublic(rawUrl: string): Promise<void> {
  if (process.env.A2A_ALLOW_PRIVATE_PEERS === 'true') return;

  const host = hostOf(rawUrl);
  if (net.isIP(host)) return; // literals were vetted synchronously

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    return;
  }

  for (const { address } of addresses) {
    if (isPrivateIpLiteral(address)) {
      throw new PeerCardUnreachableError(
        `${host} resolves to a private address (${address}) — external peers must be publicly reachable`,
        undefined,
        'invalid',
      );
    }
  }
}

function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '');
  } catch {
    throw new PeerCardUnreachableError(
      `Not a valid URL: ${rawUrl}`,
      undefined,
      'invalid',
    );
  }
}

/** True for any IP literal that is not plainly public. */
function isPrivateIpLiteral(host: string): boolean {
  const kind = net.isIP(host);
  if (kind === 6) {
    // Allow global unicast (2000::/3) only. Everything else — loopback in
    // any spelling, link-local, ULA, mapped v4, `::` — is refused.
    const first = parseInt(host.split(':', 1)[0] || '0', 16);
    return Number.isNaN(first) || first < 0x2000 || first > 0x3fff;
  }
  if (kind === 4) {
    const [a, b] = host.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return false;
}

/** `2130706433`, `0x7f000001`, `017700000001`, `127.1` — curl-style IPv4
 *  shorthand that `net.isIP` does not recognise but `fetch` would connect
 *  to. Never a legitimate agent address; refused rather than normalised. */
function isNumericShorthand(host: string): boolean {
  if (net.isIP(host) === 4) return false;
  return /^[\d.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host);
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

async function excerpt(
  response: Response,
  limit: number = BODY_EXCERPT_CHARS,
): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, limit).trim();
  } catch {
    return '';
  }
}

/**
 * For a 3xx answer: where it points ('' when it names nowhere). Null for any
 * other status. An opaque redirect (status 0, as browsers report it) counts
 * as a redirect with no known target.
 */
function redirectTarget(response: Response): string | null {
  const opaque = response.type === 'opaqueredirect';
  if (!opaque && (response.status < 300 || response.status >= 400)) {
    return null;
  }
  return response.headers?.get?.('location') ?? '';
}

/** The message of a JSON-RPC error envelope, when a failed body is one. */
function jsonRpcErrorMessage(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: unknown; message?: unknown };
    };
    const error = parsed?.error;
    if (!error || typeof error !== 'object') return null;
    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message.trim();
    }
    return typeof error.code === 'number'
      ? `protocol error ${error.code}`
      : null;
  } catch {
    return null;
  }
}
