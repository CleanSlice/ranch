// The generated SDK class is also named `BridleService`; alias it to `BridleApi`
// so it doesn't collide with the domain service of the same name.
import { BridleService as BridleApi } from '#api';
import { client as apiClient } from '#api/data/repositories/api/client.gen';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IBridleGateway } from '../domain/bridle.gateway';
import type { IBridleAttachment, IBridleReply } from '../domain/bridle.types';
import { BridleMapper } from './bridle.mapper';

export class BridleGateway extends BaseGateway implements IBridleGateway {
  private mapper = new BridleMapper();

  sendMessage(
    agentId: string,
    text: string,
    attachmentIds?: string[],
  ): Promise<IBridleReply> {
    return this.execute(async () => {
      const res = await BridleApi.sendBridleMessageSync({
        path: { agentId },
        // `attachmentIds` is omitted entirely when empty so the request is
        // byte-identical to the pre-feature one for plain text messages.
        body: {
          text,
          ...(attachmentIds?.length ? { attachmentIds } : {}),
        },
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
  ): Promise<IBridleAttachment> {
    return this.execute(async () => {
      const form = new FormData();
      form.append('file', file);

      const res = await apiClient.instance.post(
        `/api/agent/${encodeURIComponent(agentId)}/attachment`,
        form,
        {
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
  fetchAttachment(agentId: string, attachmentId: string): Promise<Blob> {
    return this.execute(async () => {
      const res = await apiClient.instance.get(
        `/api/agent/${encodeURIComponent(agentId)}/attachment/${encodeURIComponent(attachmentId)}`,
        { responseType: 'blob' },
      );
      return res.data as Blob;
    });
  }
}
