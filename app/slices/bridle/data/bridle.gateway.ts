// The generated SDK class is also named `BridleService`; alias it to `BridleApi`
// so it doesn't collide with the domain service of the same name.
import { BridleService as BridleApi } from '#api';
import { client as apiClient } from '#api/data/repositories/api/client.gen';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IBridleGateway } from '../domain/bridle.gateway';
import type {
  IBridleAttachment,
  IBridleReply,
  IBridleShareContext,
} from '../domain/bridle.types';
import { BridleMapper } from './bridle.mapper';

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

  sendMessage(
    agentId: string,
    text: string,
    attachmentIds?: string[],
    share?: IBridleShareContext,
  ): Promise<IBridleReply> {
    return this.execute(async () => {
      const headers = shareHeaders(share);
      const res = await BridleApi.sendBridleMessageSync({
        path: { agentId },
        // `attachmentIds` is omitted entirely when empty so the request is
        // byte-identical to the pre-feature one for plain text messages.
        body: {
          text,
          ...(attachmentIds?.length ? { attachmentIds } : {}),
        },
        // Spread rather than passed as `undefined`: the generated SDK merges
        // `options.headers` over its own `Content-Type`, and an absent key
        // keeps the console request exactly as it was.
        ...(headers ? { headers } : {}),
        // Without this the axios client hands the error back as a normal
        // result, and a failed send would read as an empty reply. The store
        // needs the failure — a 401 the api plugin could not recover from is
        // what takes the optimistic bubble back and keeps the text as a draft
        // for after sign-in (CLEAN-72).
        throwOnError: true,
      });
      return this.mapper.toReply(unwrapEnvelope(res.data));
    });
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
}
