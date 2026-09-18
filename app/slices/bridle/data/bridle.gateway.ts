import { io } from 'socket.io-client';
import { BridleService as BridleApi } from '#api';
import { client as apiClient } from '#api/data/repositories/api/client.gen';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IBridleGateway } from '../domain/bridle.gateway';
import type {
  IBridleAttachment,
  IBridleChannel,
  IBridleChannelAuth,
  IBridleChannelEvents,
  IBridleMessage,
  IBridleSendAck,
  IBridleShareContext,
} from '../domain/bridle.types';
import { FAILED_MS, FAILURE_TIMEOUT } from '../utils/delivery';
import { BridleMapper } from './bridle.mapper';

/**
 * What this console renders, declared at handshake. The hub forwards the list
 * to the agent on every message and the runtime emits `thinking` steps only
 * to peers that list it — without `thinking` here the timeline stays empty
 * no matter what the agent does. No `ui`: the console has no interactive
 * ui parts.
 */
const CAPABILITIES = ['streaming', 'images', 'files', 'thinking'];

/**
 * What one share-link request carries instead of the console session.
 *
 * `Authorization: null` is not decoration: on the API a valid JWT WINS over
 * the share headers. Without this, an owner opening their own link would chat
 * as themselves — their visitor messages landing in the console channel,
 * their uploads owned by `admin`, and a revoke never producing the 403 the
 * page watches for. The SDK's header merge drops a null-valued key, and the
 * request interceptor in `#api/plugins/api.ts` skips any request that carries
 * `X-Share-Token`, so the console bearer is never attached to these calls.
 */
interface IShareRequestHeaders {
  // The index signature is what lets this object stand in for axios's own
  // `RawAxiosRequestHeaders` on the two calls that skip the generated SDK.
  [header: string]: string | null;
  'X-Share-Token': string;
  'X-Share-Visitor': string;
  Authorization: null;
}

/**
 * The pair the API reads to identify a public share-link visitor. Attached per
 * request — never through `client.setConfig`, which is shared with every other
 * call in the tab and would leak a visitor's token into console traffic (and
 * survive navigating away from the share page).
 */
function shareHeaders(
  share?: IBridleShareContext,
): IShareRequestHeaders | undefined {
  if (!share) return undefined;
  return {
    'X-Share-Token': share.token,
    'X-Share-Visitor': share.visitorId,
    Authorization: null,
  };
}

export class BridleGateway extends BaseGateway implements IBridleGateway {
  private mapper = new BridleMapper();

  /**
   * @param apiUrl The API origin the socket connects to. Empty means the
   * page's own origin — the same fallback the axios client runs on.
   */
  constructor(private readonly apiUrl: string) {
    super();
  }

  /**
   * The hub's browser namespace, websocket-only like the admin preview and
   * the embed SDK. `auth` is a function on purpose: socket.io calls it on
   * every (re)connect, so a reconnect after a token renewal carries the
   * current bearer rather than the one captured when the chat mounted.
   *
   * A share visitor sends the pair and no bearer: on the hub a valid JWT
   * wins over the pair, and an owner opening their own link must chat as a
   * visitor (the HTTP calls send `Authorization: null` for the same reason).
   *
   * `lastSeq` rides in the same function for the same reason: read at
   * (re)connect time, it tells the hub what to replay after THIS gap.
   */
  openChannel(
    agentId: string,
    auth: IBridleChannelAuth,
    events: IBridleChannelEvents,
  ): IBridleChannel {
    const socket = io(`${this.apiUrl.replace(/\/$/, '')}/ws/client`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
      auth: (cb) =>
        cb({
          agentId,
          capabilities: CAPABILITIES,
          ...(auth.share
            ? {
                shareToken: auth.share.token,
                shareVisitor: auth.share.visitorId,
              }
            : { token: auth.token?.() ?? '' }),
          ...(auth.lastSeq ? { lastSeq: auth.lastSeq() } : {}),
        }),
    });
    // The channel object below is a plain literal — no `this` inside it.
    const mapper = this.mapper;

    socket.on('connect', () => events.onConnected());
    socket.on('welcome', (raw: unknown) =>
      events.onWelcome(mapper.toWelcome(raw)),
    );
    socket.on('disconnect', () => events.onDisconnected());
    socket.on('connect_error', (err: Error) => {
      // Network-level: socket.io keeps retrying on its own. Logged so a
      // misconfigured API origin is not a silent "Reconnecting…" forever.
      console.warn('[bridle] connection error:', err.message);
    });
    socket.on('bridle_error', (raw: unknown) => {
      const code = (raw as { code?: unknown } | null)?.code;
      events.onRejected(typeof code === 'string' ? code : 'UNKNOWN');
    });
    socket.on('message_error', (raw: unknown) => {
      const message = (raw as { message?: unknown } | null)?.message;
      events.onMessageError(
        typeof message === 'string' ? message : 'Message could not be delivered',
        mapper.toSeq(raw),
      );
    });
    socket.on('typing', (raw: unknown) => events.onTyping(mapper.toSeq(raw)));
    socket.on('thinking', (raw: unknown) => {
      const event = this.mapper.toThinkingEvent(raw);
      if (event) events.onThinking(event);
    });
    socket.on('stream', (raw: unknown) =>
      events.onStream(this.mapper.toReply(raw), false),
    );
    socket.on('stream_end', (raw: unknown) =>
      events.onStream(this.mapper.toReply(raw), true),
    );
    socket.on('message', (raw: unknown) =>
      events.onMessage(this.mapper.toReply(raw)),
    );
    socket.on('user_message', (raw: unknown) => {
      const message = mapper.toUserMessage(raw);
      if (message) events.onUserMessage(message);
    });

    return {
      send(text, attachmentIds, clientMessageId) {
        // Always resolves: the store turns the verdict into a delivery state,
        // and "no answer in time" is one of the verdicts. socket.io drops a
        // timed-out packet from its send buffer, so a message that failed
        // here is not quietly sent after a later reconnect.
        return new Promise<IBridleSendAck>((resolve) => {
          socket.timeout(FAILED_MS).emit(
            'message',
            {
              text,
              // Omitted entirely when empty, the way the embed SDK sends it.
              ...(attachmentIds?.length ? { attachmentIds } : {}),
              clientMessageId,
            },
            (err: Error | null, raw: unknown) =>
              resolve(
                err
                  ? { status: 'rejected', code: FAILURE_TIMEOUT }
                  : mapper.toSendAck(raw, clientMessageId),
              ),
          );
        });
      },
      reconnect() {
        // A socket the hub dropped (auth rejection) does not reconnect on its
        // own — socket.io treats a server-initiated disconnect as final.
        // `connect()` is a no-op on a still-open socket, so it is safe to
        // call whether the server's disconnect has landed yet or not.
        if (socket.connected) socket.once('disconnect', () => socket.connect());
        else socket.connect();
      },
      close() {
        socket.removeAllListeners();
        socket.disconnect();
      },
    };
  }

  /**
   * Posted on the axios instance directly rather than through the generated
   * `uploadBridleAttachment`. The SDK method exists and would work, but it
   * gives no way to observe upload progress — and a 10 MB attachment with no
   * progress bar reads as a hang. Going through `instance` still reuses the
   * apiUrl base and the Bearer interceptor, and matches how the admin's
   * knowledge-source uploads are done.
   */
  uploadAttachment(
    agentId: string,
    file: File,
    onProgress?: (percent: number) => void,
    share?: IBridleShareContext,
  ): Promise<IBridleAttachment> {
    return this.execute(async () => {
      const form = new FormData();
      form.append('file', file);
      const headers = shareHeaders(share);

      const res = await apiClient.instance.post(
        `/api/agent/${encodeURIComponent(agentId)}/attachment`,
        form,
        {
          ...(headers ? { headers } : {}),
          onUploadProgress: (event: {
            loaded: number;
            total?: number;
          }) => {
            if (!onProgress) return;
            // `total` is absent on some browsers/proxies; report indeterminate
            // progress as 0 rather than dividing by undefined.
            const percent = event.total
              ? Math.round((event.loaded / event.total) * 100)
              : 0;
            onProgress(Math.min(percent, 100));
          },
        },
      );

      return this.mapper.toAttachment(unwrapEnvelope(res.data));
    });
  }

  /**
   * Also on the axios instance rather than the SDK: the generated
   * `getBridleAttachment` types the body as a string, which would mangle
   * every non-text file. `responseType: 'blob'` keeps the bytes intact, the
   * same way the chat export download does it.
   */
  fetchAttachment(
    agentId: string,
    attachmentId: string,
    share?: IBridleShareContext,
  ): Promise<Blob> {
    return this.execute(async () => {
      const headers = shareHeaders(share);
      const res = await apiClient.instance.get(
        `/api/agent/${encodeURIComponent(agentId)}/attachment/${encodeURIComponent(attachmentId)}`,
        { responseType: 'blob', ...(headers ? { headers } : {}) },
      );
      return res.data as Blob;
    });
  }

  transcriptTail(
    agentId: string,
    channel: string,
    share?: IBridleShareContext,
  ): Promise<IBridleMessage[]> {
    return this.execute(async () => {
      const headers = shareHeaders(share);
      const res = await BridleApi.getBridleTranscript({
        path: { agentId },
        query: { channel },
        ...(headers ? { headers } : {}),
        throwOnError: true,
      });
      return this.mapper.toTranscript(unwrapEnvelope(res.data));
    });
  }
}
