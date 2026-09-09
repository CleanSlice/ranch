import {
  DetectDocumentTextCommand,
  DetectDocumentTextCommandOutput,
  GetDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommandOutput,
  StartDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommandOutput,
  type Block,
} from '@aws-sdk/client-textract';
import { ISettingGateway } from '#/setting/domain';
import {
  ITextractClient,
  TextractRepository,
  TEXTRACT_SYNC_MAX_BYTES,
} from './textract.repository';

function line(page: number, text: string): Block {
  return { BlockType: 'LINE', Page: page, Text: text };
}

interface FakeScript {
  detect?: DetectDocumentTextCommandOutput;
  start?: StartDocumentTextDetectionCommandOutput;
  /** Consumed in order, one per GetDocumentTextDetection call. */
  get?: GetDocumentTextDetectionCommandOutput[];
}

class FakeClient implements ITextractClient {
  readonly sent: Array<DetectDocumentTextCommand | StartDocumentTextDetectionCommand | GetDocumentTextDetectionCommand> = [];
  constructor(private readonly script: FakeScript) {}

  send(command: DetectDocumentTextCommand): Promise<DetectDocumentTextCommandOutput>;
  send(command: StartDocumentTextDetectionCommand): Promise<StartDocumentTextDetectionCommandOutput>;
  send(command: GetDocumentTextDetectionCommand): Promise<GetDocumentTextDetectionCommandOutput>;
  async send(
    command: DetectDocumentTextCommand | StartDocumentTextDetectionCommand | GetDocumentTextDetectionCommand,
  ): Promise<
    DetectDocumentTextCommandOutput | StartDocumentTextDetectionCommandOutput | GetDocumentTextDetectionCommandOutput
  > {
    this.sent.push(command);
    if (command instanceof DetectDocumentTextCommand) {
      return this.script.detect ?? { $metadata: {} };
    }
    if (command instanceof StartDocumentTextDetectionCommand) {
      return this.script.start ?? { $metadata: {}, JobId: 'job-1' };
    }
    const next = this.script.get?.shift();
    if (!next) throw new Error('no scripted GetDocumentTextDetection reply left');
    return next;
  }
}

const settings = {
  findByKey: jest.fn(async () => null),
} as unknown as ISettingGateway;

describe('TextractRepository', () => {
  it('reads a single page synchronously and groups lines in order', async () => {
    const client = new FakeClient({
      detect: {
        $metadata: {},
        Blocks: [
          { BlockType: 'PAGE', Page: 1 },
          line(1, 'CX-5 Order Form'),
          { BlockType: 'WORD', Page: 1, Text: 'ignored' },
          line(1, 'Effective 04/02/2023'),
        ],
      },
    });
    const repo = new TextractRepository(settings, client);

    const doc = await repo.detectSinglePage(Buffer.from('pdf'));

    expect(doc).toEqual({
      pages: [{ page: 1, lines: ['CX-5 Order Form', 'Effective 04/02/2023'] }],
    });
    expect(client.sent[0]).toBeInstanceOf(DetectDocumentTextCommand);
  });

  it('refuses the synchronous path over 10 MB instead of letting Textract reject it', async () => {
    const repo = new TextractRepository(settings, new FakeClient({}));
    await expect(
      repo.detectSinglePage(Buffer.alloc(TEXTRACT_SYNC_MAX_BYTES + 1)),
    ).rejects.toThrow('limited to');
  });

  it('starts a job, waits through IN_PROGRESS, and follows NextToken to the end', async () => {
    const client = new FakeClient({
      get: [
        { $metadata: {}, JobStatus: 'IN_PROGRESS' },
        {
          $metadata: {},
          JobStatus: 'SUCCEEDED',
          NextToken: 'more',
          Blocks: [line(1, 'first page'), line(2, 'second page, line 1')],
        },
        {
          $metadata: {},
          JobStatus: 'SUCCEEDED',
          Blocks: [line(2, 'second page, line 2')],
        },
      ],
    });
    const repo = new TextractRepository(settings, client);

    const doc = await repo.detectDocument(
      { bucket: 'b', key: 'k.pdf' },
      { pollIntervalMs: 0 },
    );

    expect(doc.pages).toEqual([
      { page: 1, lines: ['first page'] },
      { page: 2, lines: ['second page, line 1', 'second page, line 2'] },
    ]);
    const start = client.sent[0];
    expect(start).toBeInstanceOf(StartDocumentTextDetectionCommand);
    expect(client.sent.filter((c) => c instanceof GetDocumentTextDetectionCommand)).toHaveLength(3);
  });

  it('surfaces a failed job with Textract reason', async () => {
    const client = new FakeClient({
      get: [{ $metadata: {}, JobStatus: 'FAILED', StatusMessage: 'Unsupported document' }],
    });
    const repo = new TextractRepository(settings, client);

    await expect(
      repo.detectDocument({ bucket: 'b', key: 'k.pdf' }, { pollIntervalMs: 0 }),
    ).rejects.toThrow('Unsupported document');
  });

  it('gives up on a job that never finishes', async () => {
    const client = new FakeClient({
      get: Array.from({ length: 50 }, () => ({ $metadata: {}, JobStatus: 'IN_PROGRESS' as const })),
    });
    const repo = new TextractRepository(settings, client);

    await expect(
      repo.detectDocument({ bucket: 'b', key: 'k.pdf' }, { pollIntervalMs: 0, timeoutMs: 0 }),
    ).rejects.toThrow('did not finish');
  });
});
