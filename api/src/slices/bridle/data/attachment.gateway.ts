import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { S3Repository } from '#/aws/s3';
import { ISettingGateway } from '#/setting/domain';
import {
  IBridleAttachmentGateway,
  IStoreAttachmentInput,
} from '../domain/attachment.gateway';
import type { IBridleStoredAttachment } from '../domain/bridle.types';

/**
 * S3-backed attachment storage.
 *
 * Objects live under the agent's own prefix, so the existing
 * `IFileGateway.wipe(agentId)` prefix delete already removes them when the
 * agent is deleted — attachments inherit the agent's lifetime with no extra
 * cleanup path.
 *
 * The key carries no extension and no part of the uploaded filename: the id
 * alone locates the object, which keeps a hostile name from ever reaching a
 * key. The original name and MIME type ride along as S3 user metadata so the
 * download route can reproduce the right headers.
 */
@Injectable()
export class BridleAttachmentGateway extends IBridleAttachmentGateway {
  private readonly logger = new Logger(BridleAttachmentGateway.name);

  constructor(
    private readonly s3: S3Repository,
    private readonly settings: ISettingGateway,
  ) {
    super();
  }

  async store(input: IStoreAttachmentInput): Promise<{ id: string }> {
    const bucket = await this.requireBucket();
    const id = randomUUID();
    const key = BridleAttachmentGateway.keyFor(input.agentId, id);

    await this.s3.upload({
      bucket,
      key,
      body: input.body,
      contentType: input.mimeType,
      metadata: {
        // S3 user metadata must be US-ASCII; filenames are anything but.
        name: encodeURIComponent(input.name),
        mime: input.mimeType,
      },
    });

    this.logger.log(
      `stored attachment ${id} for agent=${input.agentId} ` +
        `(${input.body.length} bytes, ${input.mimeType})`,
    );
    return { id };
  }

  async fetch(
    agentId: string,
    attachmentId: string,
  ): Promise<IBridleStoredAttachment | null> {
    const bucket = await this.requireBucket();
    const key = BridleAttachmentGateway.keyFor(agentId, attachmentId);

    try {
      const stored = await this.s3.downloadWithMetadata({ bucket, key });
      return {
        id: attachmentId,
        name: decodeName(stored.metadata.name) || attachmentId,
        mimeType:
          stored.metadata.mime ||
          stored.contentType ||
          'application/octet-stream',
        size: stored.body.length,
        body: stored.body,
      };
    } catch (err) {
      // A missing object is an ordinary outcome — the UI renders it as "no
      // longer available". Anything else is worth a log line before we
      // degrade it to the same null, so a misconfigured bucket does not hide
      // behind a 404 forever.
      if (!isNotFound(err)) {
        this.logger.warn(
          `attachment fetch failed for ${agentId}/${attachmentId}: ${(err as Error).message}`,
        );
      }
      return null;
    }
  }

  /** `agents/{agentId}/data/attachments/{uuid}` — id only, no user input. */
  static keyFor(agentId: string, attachmentId: string): string {
    return `agents/${agentId}/data/attachments/${attachmentId}`;
  }

  private async requireBucket(): Promise<string> {
    const setting = await this.settings.findByKey('integrations', 's3_bucket');
    const bucket = typeof setting?.value === 'string' ? setting.value : '';
    if (!bucket) {
      // Same wording as IFileGateway so an operator sees one message for one
      // missing setting, wherever they hit it first.
      throw new BadRequestException(
        'S3 bucket is not configured (settings → integrations → s3_bucket)',
      );
    }
    return bucket;
  }
}

function decodeName(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    // Metadata written by an older or hand-rolled uploader may not be
    // percent-encoded; better a slightly wrong name than a failed download.
    return raw;
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as {
    name?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };
  if (e?.$metadata?.httpStatusCode === 404) return true;
  if (e?.name === 'NoSuchKey' || e?.name === 'NotFound') return true;
  // S3Repository wraps failures in S3RepositoryError, which keeps the original
  // reason in its message rather than the AWS error shape.
  return /NoSuchKey|NotFound|status code: 404/i.test(e?.message ?? '');
}
