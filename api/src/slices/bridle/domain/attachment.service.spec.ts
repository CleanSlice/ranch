import { BadRequestException } from '@nestjs/common';
import { BridleAttachmentService } from './attachment.service';
import { IBridleAttachmentGateway } from './attachment.gateway';
import type { IStoreAttachmentInput } from './attachment.gateway';
import {
  BridleAttachmentKinds,
  BridlePartTypes,
  type IBridleStoredAttachment,
} from './bridle.types';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_MESSAGE_ATTACHMENT_BYTES,
} from './attachment.constants';

/**
 * In-memory attachment store — mirrors the stub style used by the chat slice's
 * gateway specs. Keyed by id so `expand` can read back exactly what `upload`
 * put in, which is the behaviour under test.
 */
class StubGateway extends IBridleAttachmentGateway {
  readonly stored = new Map<string, IBridleStoredAttachment>();
  private seq = 0;

  async store(input: IStoreAttachmentInput): Promise<{ id: string }> {
    const id = `id-${++this.seq}`;
    this.stored.set(id, {
      id,
      name: input.name,
      mimeType: input.mimeType,
      size: input.body.length,
      body: input.body,
    });
    return { id };
  }

  async fetch(
    _agentId: string,
    attachmentId: string,
  ): Promise<IBridleStoredAttachment | null> {
    return this.stored.get(attachmentId) ?? null;
  }

  /** Seed an object directly, for cases upload() would refuse to create. */
  seed(id: string, attachment: Omit<IBridleStoredAttachment, 'id'>): void {
    this.stored.set(id, { id, ...attachment });
  }
}

const AGENT = 'agent-1';

function makeService(): { service: BridleAttachmentService; gw: StubGateway } {
  const gw = new StubGateway();
  return { service: new BridleAttachmentService(gw), gw };
}

describe('BridleAttachmentService — upload validation', () => {
  it('accepts a supported file and reports its kind', async () => {
    const { service } = makeService();
    const result = await service.upload({
      agentId: AGENT,
      name: 'notes.md',
      mimeType: 'text/markdown',
      body: Buffer.from('# hello'),
    });

    expect(result.kind).toBe(BridleAttachmentKinds.Text);
    expect(result.readableByAgent).toBe(true);
    expect(result.size).toBe(7);
    expect(result.url).toContain(`/api/agent/${AGENT}/attachment/`);
  });

  it('flags a binary file as unreadable by the agent', async () => {
    const { service } = makeService();
    const result = await service.upload({
      agentId: AGENT,
      name: 'report.pdf',
      mimeType: 'application/pdf',
      body: Buffer.from('%PDF-1.7'),
    });

    expect(result.kind).toBe(BridleAttachmentKinds.Binary);
    expect(result.readableByAgent).toBe(false);
  });

  it('accepts Office documents as binary references', async () => {
    const { service } = makeService();
    const cases = [
      ['macros.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'],
      [
        'sheet.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
      [
        'letter.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
      ['deck.ppt', 'application/vnd.ms-powerpoint'],
    ] as const;

    for (const [name, mimeType] of cases) {
      const result = await service.upload({
        agentId: AGENT,
        name,
        mimeType,
        body: Buffer.from('PK'),
      });
      expect(result.kind).toBe(BridleAttachmentKinds.Binary);
      expect(result.readableByAgent).toBe(false);
      expect(result.mimeType).toBe(mimeType);
    }
  });

  it('resolves an Office file by extension when the browser reports a blank type', async () => {
    const { service } = makeService();
    const result = await service.upload({
      agentId: AGENT,
      name: 'quarterly.xlsm',
      mimeType: '',
      body: Buffer.from('PK'),
    });

    expect(result.mimeType).toBe('application/vnd.ms-excel.sheet.macroEnabled.12');
    expect(result.kind).toBe(BridleAttachmentKinds.Binary);
  });

  it('rejects a zero-byte file', async () => {
    const { service } = makeService();
    await expect(
      service.upload({
        agentId: AGENT,
        name: 'empty.txt',
        mimeType: 'text/plain',
        body: Buffer.alloc(0),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a file over the per-file size limit', async () => {
    const { service } = makeService();
    await expect(
      service.upload({
        agentId: AGENT,
        name: 'huge.png',
        mimeType: 'image/png',
        body: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1),
      }),
    ).rejects.toThrow(/larger than/i);
  });

  it('rejects a type that is not on the allow-list', async () => {
    const { service } = makeService();
    await expect(
      service.upload({
        agentId: AGENT,
        name: 'archive.zip',
        mimeType: 'application/zip',
        body: Buffer.from('PK'),
      }),
    ).rejects.toThrow(/not a supported file type/i);
  });

  it('falls back to the extension when the browser reports no MIME type', async () => {
    // Browsers routinely report an empty `type` for .md and .csv; trusting the
    // reported type alone would reject perfectly ordinary files.
    const { service } = makeService();
    const result = await service.upload({
      agentId: AGENT,
      name: 'data.csv',
      mimeType: '',
      body: Buffer.from('a,b\n1,2'),
    });

    expect(result.mimeType).toBe('text/csv');
    expect(result.kind).toBe(BridleAttachmentKinds.Text);
  });

  it('does not widen an unknown reported type into an accepted one', async () => {
    const { service } = makeService();
    await expect(
      service.upload({
        agentId: AGENT,
        name: 'payload.bin',
        mimeType: 'application/x-msdownload',
        body: Buffer.from('MZ'),
      }),
    ).rejects.toThrow(/not a supported file type/i);
  });
});

describe('BridleAttachmentService — text extraction', () => {
  it('inlines a text file so the agent can actually read it', async () => {
    const { service, gw } = makeService();
    gw.seed('t1', {
      name: 'notes.md',
      mimeType: 'text/markdown',
      size: 11,
      body: Buffer.from('# Heading\nx'),
    });

    const out = await service.expand(AGENT, 'What does it say?', ['t1']);

    expect(out.text).toContain('What does it say?');
    expect(out.text).toContain('[Attached file: notes.md]');
    expect(out.text).toContain('# Heading');
  });

  it('truncates over-long text and says so', async () => {
    const { service, gw } = makeService();
    const long = 'a'.repeat(MAX_EXTRACTED_TEXT_CHARS + 500);
    gw.seed('t1', {
      name: 'big.txt',
      mimeType: 'text/plain',
      size: long.length,
      body: Buffer.from(long),
    });

    const out = await service.expand(AGENT, 'summarise', ['t1']);

    expect(out.text).toContain('characters truncated');
    expect(out.text).toContain('500');
    // The inlined body is capped, but the notice and fences add a little.
    expect(out.text.length).toBeLessThan(MAX_EXTRACTED_TEXT_CHARS + 500);
  });

  it('downgrades a text-typed file whose bytes are not decodable', async () => {
    // A .txt full of binary would otherwise put mojibake in the prompt.
    const { service, gw } = makeService();
    gw.seed('t1', {
      name: 'sneaky.txt',
      mimeType: 'text/plain',
      size: 4,
      body: Buffer.from([0xff, 0xfe, 0xfd, 0xfc]),
    });

    const out = await service.expand(AGENT, 'read this', ['t1']);

    expect(out.attachments[0].kind).toBe(BridleAttachmentKinds.Binary);
    expect(out.attachments[0].readableByAgent).toBe(false);
    // Downgraded to binary: the model gets the unreadable-file notice, and
    // none of the undecodable bytes reach the prompt as mojibake.
    expect(out.text).toContain('read this');
    expect(out.text).toContain('not readable');
    expect(out.text).not.toContain('�');
  });

  it('downgrades a text-typed file containing NUL bytes', async () => {
    const { service, gw } = makeService();
    gw.seed('t1', {
      name: 'nul.txt',
      mimeType: 'text/plain',
      size: 5,
      body: Buffer.from([0x61, 0x00, 0x62, 0x00, 0x63]),
    });

    const out = await service.expand(AGENT, 'read this', ['t1']);

    expect(out.attachments[0].kind).toBe(BridleAttachmentKinds.Binary);
    expect(out.text).toContain('read this');
    expect(out.text).toContain('not readable');
    expect(out.text).not.toContain('a b');
  });

  it('preserves non-ASCII text intact', async () => {
    const { service, gw } = makeService();
    const body = Buffer.from('Привет, мир — ok', 'utf8');
    gw.seed('t1', {
      name: 'ru.txt',
      mimeType: 'text/plain',
      size: body.length,
      body,
    });

    const out = await service.expand(AGENT, 'translate', ['t1']);

    expect(out.text).toContain('Привет, мир — ok');
  });
});

describe('BridleAttachmentService — expansion to parts', () => {
  it('returns the text untouched when there are no attachments', async () => {
    const { service } = makeService();
    const out = await service.expand(AGENT, 'plain message', undefined);

    expect(out).toEqual({ text: 'plain message', parts: [], attachments: [] });
  });

  it('turns an image into an image part carrying base64', async () => {
    const { service, gw } = makeService();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    gw.seed('i1', {
      name: 'shot.png',
      mimeType: 'image/png',
      size: bytes.length,
      body: bytes,
    });

    const out = await service.expand(AGENT, 'what is this?', ['i1']);

    expect(out.parts).toHaveLength(1);
    expect(out.parts[0]).toEqual({
      type: BridlePartTypes.Image,
      base64: bytes.toString('base64'),
      mediaType: 'image/png',
    });
    // Images reach the model as image content, so nothing is inlined.
    expect(out.text).toBe('what is this?');
  });

  it('turns a binary into a file part and inlines an unreadable-file notice', async () => {
    const { service, gw } = makeService();
    gw.seed('b1', {
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 8,
      body: Buffer.from('%PDF-1.7'),
    });

    const out = await service.expand(AGENT, 'read it', ['b1']);

    expect(out.parts[0]).toMatchObject({
      type: BridlePartTypes.File,
      name: 'report.pdf',
      mimeType: 'application/pdf',
    });
    // The runtime drops file parts before the model call, so without this
    // notice the model would never learn the file exists at all.
    expect(out.text).toContain('read it');
    expect(out.text).toContain('report.pdf');
    expect(out.text).toContain('not readable');
    // Never the contents — only the reference.
    expect(out.text).not.toContain('%PDF-1.7');
  });

  it('gives an attachment-only binary message a visible text body', async () => {
    const { service, gw } = makeService();
    gw.seed('b1', {
      name: 'haha.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 2,
      body: Buffer.from('PK'),
    });

    const out = await service.expand(AGENT, '', ['b1']);

    expect(out.text).toContain('haha.xlsx');
  });

  it('emits a file part AND inlined text for a text attachment', async () => {
    const { service, gw } = makeService();
    gw.seed('t1', {
      name: 'a.txt',
      mimeType: 'text/plain',
      size: 5,
      body: Buffer.from('hello'),
    });

    const out = await service.expand(AGENT, 'hi', ['t1']);

    expect(out.parts).toHaveLength(1);
    expect(out.parts[0].type).toBe(BridlePartTypes.File);
    expect(out.text).toContain('hello');
  });

  it('preserves the order the ids were given in', async () => {
    const { service, gw } = makeService();
    gw.seed('a', {
      name: 'a.png',
      mimeType: 'image/png',
      size: 1,
      body: Buffer.from([1]),
    });
    gw.seed('b', {
      name: 'b.pdf',
      mimeType: 'application/pdf',
      size: 1,
      body: Buffer.from([2]),
    });

    const out = await service.expand(AGENT, 'x', ['b', 'a']);

    expect(out.attachments.map((a) => a.name)).toEqual(['b.pdf', 'a.png']);
  });

  it('rejects an id that no longer resolves to an object', async () => {
    const { service } = makeService();
    await expect(service.expand(AGENT, 'x', ['gone'])).rejects.toThrow(
      /no longer available/i,
    );
  });

  it('rejects more attachments than one message may carry', async () => {
    const { service } = makeService();
    await expect(
      service.expand(AGENT, 'x', ['a', 'b', 'c', 'd', 'e', 'f']),
    ).rejects.toThrow(/At most/i);
  });

  it('rejects a combined payload over the per-message total', async () => {
    const { service, gw } = makeService();
    const half = Math.ceil(MAX_MESSAGE_ATTACHMENT_BYTES / 2) + 1;
    for (const id of ['a', 'b']) {
      gw.seed(id, {
        name: `${id}.png`,
        mimeType: 'image/png',
        size: half,
        body: Buffer.alloc(half),
      });
    }

    await expect(service.expand(AGENT, 'x', ['a', 'b'])).rejects.toThrow(
      /total less than/i,
    );
  });
});
