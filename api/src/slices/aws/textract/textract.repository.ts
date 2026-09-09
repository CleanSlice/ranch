import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DetectDocumentTextCommand,
  DetectDocumentTextCommandOutput,
  GetDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommandOutput,
  StartDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommandOutput,
  TextractClient,
  type Block,
} from '@aws-sdk/client-textract';
import { ISettingGateway } from '#/setting/domain';
import {
  ITextractDetectOptions,
  ITextractDocument,
  ITextractLocation,
  ITextractPage,
} from './textract.types';

/**
 * The slice of TextractClient this repository uses. Narrow on purpose so a
 * test can hand in a plain object that answers the three commands, and so
 * the real client satisfies it structurally without any cast.
 */
export interface ITextractClient {
  send(
    command: DetectDocumentTextCommand,
  ): Promise<DetectDocumentTextCommandOutput>;
  send(
    command: StartDocumentTextDetectionCommand,
  ): Promise<StartDocumentTextDetectionCommandOutput>;
  send(
    command: GetDocumentTextDetectionCommand,
  ): Promise<GetDocumentTextDetectionCommandOutput>;
}

export const TEXTRACT_CLIENT = Symbol('TEXTRACT_CLIENT');

/** Synchronous detection takes a single page and at most 10 MB in memory. */
export const TEXTRACT_SYNC_MAX_BYTES = 10 * 1024 * 1024;

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps `@aws-sdk/client-textract` and nothing else. Built from the same
 * `integrations/*` settings as S3Repository, so the identity that reads the
 * bucket is the one Textract uses to read it too - the asynchronous API
 * fetches the object from S3 with the caller's credentials.
 *
 * A self-contained repository: it imports no slice's `domain/` and speaks
 * only its own types. The gateway in reins/extraction adapts them.
 */
@Injectable()
export class TextractRepository {
  private readonly logger = new Logger(TextractRepository.name);
  private client: ITextractClient | null;

  constructor(
    private readonly settings: ISettingGateway,
    // Tests hand in a stub; production leaves it out and the client is built
    // from settings on first use.
    @Optional() @Inject(TEXTRACT_CLIENT) injected: ITextractClient | null = null,
  ) {
    this.client = injected;
  }

  /**
   * One page, bytes in the request. The only synchronous shape Textract
   * accepts for a PDF: a second page or a byte over the cap is refused.
   */
  async detectSinglePage(bytes: Buffer): Promise<ITextractDocument> {
    if (bytes.length > TEXTRACT_SYNC_MAX_BYTES) {
      throw new Error(
        `Textract synchronous detection is limited to ${TEXTRACT_SYNC_MAX_BYTES} bytes, got ${bytes.length}`,
      );
    }
    const client = await this.getClient();
    const out = await client.send(
      new DetectDocumentTextCommand({ Document: { Bytes: bytes } }),
    );
    return groupPages(out.Blocks ?? []);
  }

  /**
   * Any size up to Textract's own limits (500 MB, 3000 pages), read straight
   * from S3. Starts a job and polls it; the result can span several pages of
   * blocks, followed through NextToken.
   */
  async detectDocument(
    location: ITextractLocation,
    options: ITextractDetectOptions = {},
  ): Promise<ITextractDocument> {
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const client = await this.getClient();

    const started = await client.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: {
          S3Object: { Bucket: location.bucket, Name: location.key },
        },
      }),
    );
    const jobId = started.JobId;
    if (!jobId) {
      throw new Error('Textract did not return a job id');
    }

    const deadline = Date.now() + timeoutMs;
    const blocks: Block[] = [];
    let nextToken: string | undefined;

    for (;;) {
      const page = await client.send(
        new GetDocumentTextDetectionCommand({
          JobId: jobId,
          ...(nextToken ? { NextToken: nextToken } : {}),
        }),
      );

      if (page.JobStatus === 'IN_PROGRESS') {
        if (Date.now() >= deadline) {
          throw new Error(
            `Textract job ${jobId} did not finish within ${Math.round(timeoutMs / 60_000)} min`,
          );
        }
        await sleep(pollIntervalMs);
        continue;
      }
      if (page.JobStatus === 'FAILED') {
        throw new Error(
          `Textract job ${jobId} failed: ${page.StatusMessage ?? 'no reason given'}`,
        );
      }
      if (page.JobStatus === 'PARTIAL_SUCCESS') {
        // Some pages could not be read (a corrupt image, an unsupported
        // rotation). What came back is still worth indexing; the gap is
        // logged rather than hidden and rather than fatal.
        this.logger.warn(
          `Textract job ${jobId} partially succeeded: ${page.StatusMessage ?? 'no detail'}`,
        );
      }

      blocks.push(...(page.Blocks ?? []));
      nextToken = page.NextToken;
      if (!nextToken) break;
    }

    return groupPages(blocks);
  }

  private async getClient(): Promise<ITextractClient> {
    if (this.client) return this.client;

    const get = async (name: string): Promise<string> => {
      const setting = await this.settings.findByKey('integrations', name);
      const value = setting?.value;
      return typeof value === 'string' ? value : '';
    };
    const [region, accessKeyId, secretAccessKey] = await Promise.all([
      get('aws_region'),
      get('aws_access_key_id'),
      get('aws_secret_access_key'),
    ]);

    // Same rule as S3Repository: static keys when both are set, otherwise the
    // SDK's provider chain (IRSA / pod identity on EKS). Textract has no
    // custom-endpoint story, so there is no MinIO branch here.
    this.logger.log(
      `building Textract client: region=${region || 'us-east-1 (default)'} ` +
        `credentials=${accessKeyId && secretAccessKey ? 'static' : 'provider-chain'}`,
    );
    this.client = new TextractClient({
      region: region || 'us-east-1',
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    });
    return this.client;
  }
}

/**
 * LINE blocks, in the order Textract emitted them, bucketed by page. Textract
 * returns lines in reading order within a page, and pages in order, so no
 * sorting is needed - only the grouping.
 */
function groupPages(blocks: readonly Block[]): ITextractDocument {
  const byPage = new Map<number, ITextractPage>();
  for (const block of blocks) {
    if (block.BlockType !== 'LINE' || typeof block.Text !== 'string') continue;
    const page = block.Page ?? 1;
    const entry = byPage.get(page) ?? { page, lines: [] };
    entry.lines.push(block.Text);
    byPage.set(page, entry);
  }
  return {
    pages: [...byPage.values()].sort((a, b) => a.page - b.page),
  };
}
