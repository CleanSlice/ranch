import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { HttpException, Inject, Logger, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AuthErrorCodes,
  classifyJwtError,
} from '#/user/auth/domain/auth.types';
import { Server, Socket } from 'socket.io';
import {
  IBridleGateway,
  BridleAttachmentService,
  type BridlePart,
  type ChatRequesterKinds,
  buildParts,
  clientIdFromJwtPayload,
} from '../domain';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import {
  ShareLinkErrorCodes,
  ShareLinkService,
} from '#/agent/shareLink/domain';

/**
 * The share-link pair a visitor's socket was admitted with. Kept on
 * `client.data` so every message re-checks the link the way the HTTP routes
 * do — a revoked link must stop a live socket too, not only the next page load.
 */
interface IShareSocketAuth {
  token: string;
  visitorId: string;
}

/**
 * WebSocket gateway for BROWSER clients.
 * Browsers connect here: ws://hub-host/ws/client
 *
 * Auth (token-first, same order as `BridleController.resolveRequester`):
 *   1. Authenticated — if a JWT is present it is verified and WINS: clientId is
 *      the JWT `sub` (or "admin" for the admin role). Takes precedence over the
 *      public path so a token-carrying embed keeps its stable per-user channel
 *      even on a public agent + whitelisted origin.
 *   2. Share link — `shareToken` + `shareVisitor` in the handshake (the socket
 *      twin of the `X-Share-Token` / `X-Share-Visitor` headers). Checked
 *      against the agent on connect AND on every message, so a revoked link
 *      drops the socket with `SHARE_LINK_INVALID`. An unusable JWT next to a
 *      share pair is ignored, not fatal: a console user whose session expired
 *      must still be able to use a share page open in the same browser.
 *   3. Public agent — no credentials (or an invalid JWT on a public agent):
 *      allowed when `isPublic: true` and the request `Origin` matches
 *      `allowedOrigins`. clientId is `anon-<id>`, reusing a client-supplied
 *      stable id when given.
 *
 * Events (browser → hub):
 *   "message"  { text, images?, attachmentIds? }
 *   "ping"     {}
 *
 * Events (hub → browser):
 *   "welcome"       { clientId }
 *   "message"       { text, messageId, ts }
 *   "stream"        { text, messageId, ts }
 *   "stream_end"    { text, messageId, ts }
 *   "typing"        { ts }
 *   "pong"          { ts }
 *   "bridle_error"  { code, agentId?, origin? }  // emitted just before a rejected handshake disconnects, so the SDK can show a reason
 *   "message_error" { message }                  // a message that could not be delivered; the socket stays up
 */
@WebSocketGateway({ namespace: '/ws/client', cors: { origin: '*' } })
export class BridleClientWsHandler
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(BridleClientWsHandler.name);

  constructor(
    private readonly hub: IBridleGateway,
    private readonly attachments: BridleAttachmentService,
    private readonly jwt: JwtService,
    @Inject(forwardRef(() => IAgentGateway))
    private readonly agentGateway: IAgentGateway,
    private readonly shareLinks: ShareLinkService,
  ) {}

  async handleConnection(client: Socket) {
    const auth = (client.handshake.auth ?? {}) as {
      agentId?: string;
      botId?: string;
      token?: string;
      anonId?: string;
      prompt?: string;
      capabilities?: unknown;
      shareToken?: unknown;
      shareVisitor?: unknown;
    };
    // Offered AT ALL, like `hasShareToken` on the HTTP side: an empty token
    // must reach `authorizeChat` and come back rejected, never slip past into
    // the public/anonymous path.
    const shareOffered = auth.shareToken !== undefined;
    // Accept legacy `botId` from browsers running cached pre-0.3.0 SDK
    // bundles. Drop after CDN/embedders have rolled forward.
    const agentId = auth.agentId ?? auth.botId;
    const origin = client.handshake.headers.origin;

    // Emit a structured reason then drop the connection. Plain `disconnect()`
    // sends a namespace DISCONNECT after the queued event, so the SDK
    // reliably sees `bridle_error` first; `disconnect(true)` would force the
    // engine.io transport closed before the event packet flushes.
    const reject = (code: string, extra?: Record<string, unknown>) => {
      client.emit('bridle_error', {
        code,
        agentId,
        origin,
        ...(extra ?? {}),
      });
      client.disconnect();
    };

    if (!agentId) {
      this.logger.warn('Browser connection rejected: missing agentId');
      return reject('MISSING_AGENT_ID');
    }

    const agent = await this.agentGateway.findById(agentId);

    // Public (token-less) embeds are allowed only when the agent opts in AND
    // the browser's Origin is whitelisted.
    const publicAllowed = !!(
      agent?.isPublic &&
      origin &&
      agent.allowedOrigins.includes(origin)
    );

    // Stable anonymous channel. Honor a client-supplied id (the SDK persists
    // one in the browser's localStorage) so a visitor keeps the SAME transcript
    // across reconnects and page reloads — otherwise we mint a fresh random id
    // on every connection, which churns through empty channels and loses
    // history. Always namespaced under `anon-` and sanitized, so a supplied id
    // can never collide with a JWT `sub`/`admin` nor escape the
    // `bridle:<clientId>.jsonl` session path. Falls back to a fresh random id.
    const anonClientId = () =>
      `anon-${sanitizeAnonId(auth.anonId) ?? randomId()}`;

    let clientId: string | undefined;
    let isAdmin = false;
    let email: string | undefined;
    // Carried onto client.data so attachment reads on this socket answer to
    // the same ownership rule as the HTTP routes, without anyone re-deriving
    // "was this a real login?" from the shape of the client id.
    let kind: ChatRequesterKinds = 'anonymous';
    let share: IShareSocketAuth | undefined;

    if (auth.token) {
      // Authenticated path takes PRECEDENCE over the public/anon path: a
      // token-carrying embed must get its stable per-user channel (JWT `sub`)
      // even when the agent is also public on a whitelisted origin.
      let payload: Record<string, unknown> | null = null;
      let verifyError: unknown;
      try {
        payload = this.jwt.verify<Record<string, unknown>>(auth.token);
      } catch (err) {
        payload = null;
        verifyError = err;
      }

      // A signed token with neither an admin role nor a `sub` proves nothing
      // usable — treated exactly like a bad one rather than becoming an
      // `undefined` client id.
      const identity = clientIdFromJwtPayload(payload);
      if (identity) {
        isAdmin = identity.isAdmin;
        clientId = identity.clientId;
        email = payload?.email as string | undefined;
        kind = 'jwt';
      } else if (shareOffered) {
        // Unusable console token next to a share pair: the pair decides
        // below, exactly like the HTTP guard. Nothing to reject yet.
      } else if (publicAllowed) {
        // A bad/expired token on an otherwise-public embed shouldn't hard-fail
        // the visitor — degrade to the anonymous path instead of rejecting.
        clientId = anonClientId();
        this.logger.log(
          `Browser connected (public, invalid token ignored): clientId=${clientId} agentId=${agentId} origin=${origin}`,
        );
      } else {
        // `TOKEN_EXPIRED` lets the admin console renew and reconnect once;
        // `INVALID_TOKEN` keeps its historical name for the embed SDK.
        // follow-up: embed SDK refresh path (the public-agent branch above
        // still degrades a dead token to anonymous for that reason).
        const code =
          verifyError &&
          classifyJwtError(verifyError) === AuthErrorCodes.TokenExpired
            ? 'TOKEN_EXPIRED'
            : 'INVALID_TOKEN';
        this.logger.warn(`Browser connection rejected: ${code}`);
        return reject(code);
      }
    }

    if (clientId === undefined && shareOffered) {
      // Share-link visitor. The agent id ALWAYS comes from the handshake's
      // own `agentId`, which is what this socket is bound to — a visitor can
      // never authorize against one agent and then talk to another. The
      // service's 403 code travels as-is so the page can tell a dead link
      // from a malformed visitor id. The token is a secret: never logged.
      const candidate: IShareSocketAuth = {
        token: typeof auth.shareToken === 'string' ? auth.shareToken : '',
        visitorId:
          typeof auth.shareVisitor === 'string' ? auth.shareVisitor : '',
      };
      try {
        clientId = await this.shareLinks.authorizeChat(
          candidate.token,
          agentId,
          candidate.visitorId,
        );
      } catch (err) {
        const code = shareRejectCode(err);
        this.logger.warn(
          `Browser connection rejected: ${code} (agentId=${agentId}, share visitor)`,
        );
        return reject(code);
      }
      kind = 'share';
      share = candidate;
      this.logger.log(
        `Browser connected (share): clientId=${clientId} agentId=${agentId}`,
      );
    }

    if (clientId === undefined) {
      if (publicAllowed) {
        // Public-agent path: anonymous browser session, no token required.
        clientId = anonClientId();
        this.logger.log(
          `Browser connected (public): clientId=${clientId} agentId=${agentId} origin=${origin}`,
        );
      } else {
        // No credentials AND public flow either disabled or origin not
        // whitelisted. When the agent IS configured public, surface
        // ORIGIN_NOT_ALLOWED so the embed UI can prompt the integrator to
        // whitelist their domain.
        const code = agent?.isPublic ? 'ORIGIN_NOT_ALLOWED' : 'MISSING_TOKEN';
        this.logger.warn(
          `Browser connection rejected: ${code} (agentId=${agentId}, origin=${origin ?? 'none'})`,
        );
        return reject(code);
      }
    }

    client.data = {
      clientId,
      agentId,
      email,
      isAdmin,
      kind,
      ...(share ? { share } : {}),
    };

    // Integrator context from the embed's `data-prompt` (set on the `<script>`
    // tag or `<bridle-chat>` element). Sent once at handshake; the hub stores
    // it per-client and forwards it on every message so the agent runtime can
    // fold it into the system prompt. Treated as untrusted downstream.
    const prompt =
      typeof auth.prompt === 'string' && auth.prompt.trim()
        ? auth.prompt
        : undefined;

    // Render capabilities the client advertised at handshake (SDK ≥ 0.12
    // sends streaming/images/files/ui; ≥ 0.15 adds thinking). Forwarded on
    // every message so the runtime can gate what it emits to this peer.
    const capabilities = Array.isArray(auth.capabilities)
      ? (auth.capabilities as unknown[]).filter(
          (c): c is string => typeof c === 'string',
        )
      : undefined;

    const send = (data: unknown) => {
      const event =
        ((data as Record<string, unknown>)?.type as string) ?? 'data';
      client.emit(event, data);
    };

    this.hub.registerClient(
      clientId,
      agentId,
      client.id,
      send,
      isAdmin,
      prompt,
      capabilities,
    );
    client.emit('welcome', { clientId });
    // Tell the new client whether the agent runtime is currently online so the
    // chat header can render the right indicator color before any subsequent
    // register/unregister broadcasts.
    client.emit('agent_status', {
      type: 'agent_status',
      agentId,
      connected: this.hub.isAgentConnected(agentId),
    });

    this.logger.log(
      `Browser connected: clientId=${clientId} agentId=${agentId} admin=${isAdmin}`,
    );
  }

  handleDisconnect(client: Socket) {
    const clientId = client.data?.clientId as string | undefined;
    const agentId = client.data?.agentId as string | undefined;
    if (clientId && agentId) {
      this.hub.unregisterClient(clientId, agentId, client.id);
      this.logger.log(
        `Browser disconnected: clientId=${clientId} agentId=${agentId}`,
      );
    }
  }

  @SubscribeMessage('message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      text?: string;
      parts?: BridlePart[];
      images?: Array<{ base64: string; mediaType: string }>;
      attachmentIds?: string[];
    },
  ) {
    const clientId = client.data?.clientId as string;
    const agentId = client.data?.agentId as string;
    if (!clientId || !agentId) return;

    // A share link is re-validated per message, as the HTTP routes do: a
    // revoked link must stop a socket that is already open, not only the next
    // page load. The rejection goes out as `bridle_error` so the share page
    // can switch to its revoked state, then the socket is dropped.
    const share = client.data?.share as IShareSocketAuth | undefined;
    if (share) {
      try {
        await this.shareLinks.authorizeChat(
          share.token,
          agentId,
          share.visitorId,
        );
      } catch (err) {
        const code = shareRejectCode(err);
        this.logger.warn(
          `Share message rejected: ${code} (clientId=${clientId} agentId=${agentId})`,
        );
        client.emit('bridle_error', { code, agentId });
        client.disconnect();
        return;
      }
    }

    const text = data.text ?? '';
    const base = data.parts ?? buildParts(text, data.images);

    // Same expansion the HTTP routes perform, so a file behaves identically
    // whether the chat talks over the socket or posts a message — including
    // the ownership rule: this socket reads only what its identity may read.
    // Kind is read back from the handshake, never guessed from the client id;
    // a socket that somehow carries none is treated as anonymous, which is
    // exactly what a token-less embed visitor has always been.
    const kind = (client.data?.kind as ChatRequesterKinds) ?? 'anonymous';
    let expanded;
    try {
      expanded = await this.attachments.expand(
        agentId,
        text,
        data.attachmentIds,
        {
          clientId,
          kind,
        },
      );
    } catch (err) {
      // A dead or oversized attachment must not take the socket down with it —
      // the person still has their draft and every other file in the composer.
      const message =
        err instanceof Error ? err.message : 'Attachment could not be read';
      this.logger.warn(
        `Attachment expansion failed: clientId=${clientId} agentId=${agentId}: ${message}`,
      );
      client.emit('message_error', { message });
      return;
    }

    const parts = [...base, ...expanded.parts];
    if (!expanded.text && parts.length === 0) return;

    this.hub.sendToAgent(
      clientId,
      agentId,
      expanded.text,
      parts,
      expanded.attachments,
    );
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit('pong', { ts: Date.now() });
  }
}

/**
 * The `{ code }` a share-link rejection carries (`SHARE_LINK_INVALID` /
 * `SHARE_VISITOR_INVALID`). Anything that is not the service's own 403 —
 * a database hiccup, say — is reported as an invalid link rather than leaking
 * an internal message to an anonymous visitor.
 */
function shareRejectCode(err: unknown): string {
  if (err instanceof HttpException) {
    const body = err.getResponse();
    const code = (body as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && code) return code;
  }
  return ShareLinkErrorCodes.LinkInvalid;
}

function randomId(): string {
  return (
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  );
}

// Restrict a client-supplied anonymous id to a safe, bounded token so it can
// only ever produce an `anon-<id>` channel — never a path-traversal into the
// `bridle:<clientId>.jsonl` session store, and never a value that could
// impersonate a JWT `sub` or the reserved `admin` id.
function sanitizeAnonId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(trimmed) ? trimmed : undefined;
}
