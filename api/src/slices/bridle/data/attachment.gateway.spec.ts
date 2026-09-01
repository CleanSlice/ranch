import { BadRequestException } from '@nestjs/common';
import { BridleAttachmentGateway } from './attachment.gateway';

/** Minimal S3Repository stub — records what was asked of it. */
function makeS3Stub() {
  const objects = new Map<
    string,
    { body: Buffer; contentType: string; metadata: Record<string, string> }
  >();

  return {
    objects,
    upload: jest.fn(async (input: any) => {
      objects.set(input.key, {
        body: input.body,
        contentType: input.contentType,
        metadata: input.metadata ?? {},
      });
      return { bucket: input.bucket, key: input.key, uri: 's3://x' };
    }),
    downloadWithMetadata: jest.fn(async ({ key }: { key: string }) => {
      const found = objects.get(key);
      if (!found) {
        throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      }
      return found;
    }),
  };
}

function makeSettingsStub(bucket: string | null) {
  return {
    findByKey: jest.fn(async () => (bucket ? { value: bucket } : null)),
  };
}

function makeGateway(bucket: string | null = 'ranch-bucket') {
  const s3 = makeS3Stub();
  const settings = makeSettingsStub(bucket);
  const gateway = new BridleAttachmentGateway(s3 as any, settings as any);
  return { gateway, s3, settings };
}

describe('BridleAttachmentGateway — key derivation', () => {
  it('keys objects under the agent prefix so agent deletion cleans them up', () => {
    const key = BridleAttachmentGateway.keyFor('agent-7', 'abc-123');
    expect(key).toBe('agents/agent-7/data/attachments/abc-123');
  });

  it('never lets the uploaded filename reach the key', async () => {
    const { gateway, s3 } = makeGateway();

    await gateway.store({
      agentId: 'agent-1',
      name: '../../etc/passwd\n.txt',
      mimeType: 'text/plain',
      body: Buffer.from('x'),
    });

    const key = s3.upload.mock.calls[0][0].key as string;
    expect(key).not.toContain('passwd');
    expect(key).not.toContain('..');
    expect(key).not.toContain('\n');
    expect(key).toMatch(/^agents\/agent-1\/data\/attachments\/[0-9a-f-]{36}$/);
  });

  it('stores the original name as percent-encoded metadata', async () => {
    // S3 user metadata must be US-ASCII; filenames are anything but.
    const { gateway, s3 } = makeGateway();

    await gateway.store({
      agentId: 'agent-1',
      name: 'отчёт.pdf',
      mimeType: 'application/pdf',
      body: Buffer.from('%PDF'),
    });

    const metadata = s3.upload.mock.calls[0][0].metadata as Record<
      string,
      string
    >;
    expect(metadata.name).toBe(encodeURIComponent('отчёт.pdf'));
    // Printable ASCII only: S3 metadata headers cannot carry anything else,
    // which is the whole reason the name is percent-encoded going in.
    // Written as a printable range rather than starting at \x00 — a control
    // character in a regex trips eslint's no-control-regex, and CI runs it.
    expect(metadata.name).toMatch(/^[\x20-\x7E]*$/);
  });
});

describe('BridleAttachmentGateway — round trip', () => {
  it('returns bytes, name and type unchanged', async () => {
    const { gateway } = makeGateway();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

    const { id } = await gateway.store({
      agentId: 'agent-1',
      name: 'скрин.png',
      mimeType: 'image/png',
      body: bytes,
    });
    const fetched = await gateway.fetch('agent-1', id);

    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('скрин.png');
    expect(fetched!.mimeType).toBe('image/png');
    expect(fetched!.size).toBe(bytes.length);
    expect(Buffer.compare(fetched!.body, bytes)).toBe(0);
  });

  it('returns null for a missing object rather than throwing', async () => {
    // The UI renders this as "no longer available"; a throw here would be a 500.
    const { gateway } = makeGateway();
    await expect(gateway.fetch('agent-1', 'not-there')).resolves.toBeNull();
  });

  it('reads an object from another agent as missing', async () => {
    const { gateway } = makeGateway();
    const { id } = await gateway.store({
      agentId: 'agent-1',
      name: 'a.txt',
      mimeType: 'text/plain',
      body: Buffer.from('x'),
    });

    await expect(gateway.fetch('agent-2', id)).resolves.toBeNull();
  });

  it('names the missing setting when the bucket is not configured', async () => {
    const { gateway } = makeGateway(null);
    await expect(
      gateway.store({
        agentId: 'agent-1',
        name: 'a.txt',
        mimeType: 'text/plain',
        body: Buffer.from('x'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
