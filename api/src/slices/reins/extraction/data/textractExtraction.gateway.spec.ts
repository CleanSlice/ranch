import {
  ITextractDocument,
  TextractRepository,
  TEXTRACT_SYNC_MAX_BYTES,
} from '#/aws/textract';
import {
  TextractExtractionGateway,
  renderDocument,
} from './textractExtraction.gateway';
import { ITextExtractionInput } from '../domain/textExtraction.types';

function doc(pages: string[][]): ITextractDocument {
  return { pages: pages.map((lines, i) => ({ page: i + 1, lines })) };
}

interface IRepoScript {
  single?: ITextractDocument | Error;
  whole?: ITextractDocument;
}

function makeRepo(script: IRepoScript) {
  return {
    detectSinglePage: jest.fn(async (): Promise<ITextractDocument> => {
      if (script.single instanceof Error) throw script.single;
      return script.single ?? doc([['inline']]);
    }),
    detectDocument: jest.fn(
      async (): Promise<ITextractDocument> => script.whole ?? doc([['from s3']]),
    ),
  };
}

function makeGateway(script: IRepoScript) {
  const repo = makeRepo(script);
  return {
    repo,
    gateway: new TextractExtractionGateway(repo as unknown as TextractRepository),
  };
}

function input(overrides: Partial<ITextExtractionInput> = {}): ITextExtractionInput {
  return { bucket: 'b', key: 'k/scan.pdf', bytes: Buffer.alloc(16), pages: 1, ...overrides };
}

describe('TextractExtractionGateway', () => {
  it('sends a small single page inline', async () => {
    const { gateway, repo } = makeGateway({});
    expect(await gateway.extractText(input())).toBe('--- page 1 ---\ninline');
    expect(repo.detectSinglePage).toHaveBeenCalledTimes(1);
    expect(repo.detectDocument).not.toHaveBeenCalled();
  });

  it('starts a job for a multi-page document', async () => {
    const { gateway, repo } = makeGateway({ whole: doc([['a'], ['b', 'c']]) });
    expect(await gateway.extractText(input({ pages: 3 }))).toBe(
      '--- page 1 ---\na\n\n--- page 2 ---\nb\nc',
    );
    expect(repo.detectSinglePage).not.toHaveBeenCalled();
    expect(repo.detectDocument).toHaveBeenCalledWith({ bucket: 'b', key: 'k/scan.pdf' });
  });

  it('starts a job for a single page the synchronous call would refuse by size', async () => {
    const { gateway, repo } = makeGateway({});
    await gateway.extractText(input({ bytes: Buffer.alloc(TEXTRACT_SYNC_MAX_BYTES + 1) }));
    expect(repo.detectSinglePage).not.toHaveBeenCalled();
    expect(repo.detectDocument).toHaveBeenCalledTimes(1);
  });

  it('falls back to the job when Textract will not take the PDF inline', async () => {
    const refused = new Error('Request has unsupported document format');
    refused.name = 'UnsupportedDocumentException';
    const { gateway, repo } = makeGateway({ single: refused });

    expect(await gateway.extractText(input())).toBe('--- page 1 ---\nfrom s3');
    expect(repo.detectDocument).toHaveBeenCalledTimes(1);
  });

  it('lets any other synchronous failure through', async () => {
    const denied = new Error('not authorized');
    denied.name = 'AccessDeniedException';
    const { gateway, repo } = makeGateway({ single: denied });

    await expect(gateway.extractText(input())).rejects.toThrow('not authorized');
    expect(repo.detectDocument).not.toHaveBeenCalled();
  });

  it('refuses to hand back a document OCR found nothing in', async () => {
    const { gateway } = makeGateway({ single: doc([[]]) });
    await expect(gateway.extractText(input())).rejects.toThrow('found no text');
  });

  it('keeps page markers so a chunk keeps its page', () => {
    expect(renderDocument(doc([['x'], []]))).toBe('--- page 1 ---\nx\n\n--- page 2 ---\n');
  });
});
