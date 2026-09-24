import {
  HeadObjectCommand,
  PutObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { ISettingGateway } from '../../../setting/domain/setting.gateway';
import { RANCH_ORIGIN_METADATA, S3FileGateway } from './file.gateway';

// Every S3 write made through Ranch carries an origin tag so the sync guard
// (CLEAN-115) can tell a console edit from the pod's own watcher upload. The
// SDK client is replaced by a recording `send`; command inputs stay real.
const send = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send })),
  };
});

const settings = {
  findByKey: async (_group: string, name: string) => ({
    value: name === 's3_bucket' ? 'test-bucket' : '',
  }),
} as unknown as ISettingGateway;

function notFound(): S3ServiceException {
  return new S3ServiceException({
    name: 'NotFound',
    $fault: 'client',
    $metadata: { httpStatusCode: 404 },
  });
}

describe('S3FileGateway origin tag', () => {
  let gateway: S3FileGateway;

  beforeEach(() => {
    send.mockReset();
    gateway = new S3FileGateway(settings);
  });

  it('tags text saves with the Ranch origin', async () => {
    send.mockResolvedValue({});
    await gateway.saveRaw('agent-1', 'notes.md', 'hello');
    const put = send.mock.calls[0][0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input.Key).toBe('agents/agent-1/notes.md');
    expect(put.input.Metadata).toEqual(RANCH_ORIGIN_METADATA);
  });

  it('tags raw byte writes (import) with the Ranch origin', async () => {
    send.mockResolvedValue({});
    await gateway.putObjectRaw('agent-1', 'img/logo.png', Buffer.from('x'));
    const put = send.mock.calls[0][0] as PutObjectCommand;
    expect(put.input.Metadata).toEqual(RANCH_ORIGIN_METADATA);
  });

  it('tags skill files written from the template bundle', async () => {
    send.mockResolvedValue({ Contents: [] });
    await gateway.syncSkills('agent-1', [
      { name: 'greet', body: '# greet', files: [{ path: 'x.md', content: 'x' }] },
    ]);
    const puts = send.mock.calls
      .map((c) => c[0])
      .filter(
        (c): c is PutObjectCommand =>
          c instanceof PutObjectCommand &&
          !String(c.input.Key).endsWith(S3FileGateway.MANAGED_MARKER),
      );
    expect(puts.length).toBe(2);
    for (const put of puts) {
      expect(put.input.Metadata).toEqual(RANCH_ORIGIN_METADATA);
    }
  });

  describe('wasWrittenByRanch', () => {
    it('is true for an object carrying the tag', async () => {
      send.mockResolvedValue({ Metadata: { ...RANCH_ORIGIN_METADATA } });
      await expect(
        gateway.wasWrittenByRanch('agent-1', 'SOUL.md'),
      ).resolves.toBe(true);
      const head = send.mock.calls[0][0] as HeadObjectCommand;
      expect(head).toBeInstanceOf(HeadObjectCommand);
      expect(head.input.Key).toBe('agents/agent-1/SOUL.md');
    });

    it('is false for an untagged object (pushed by the pod)', async () => {
      send.mockResolvedValue({ Metadata: {} });
      await expect(
        gateway.wasWrittenByRanch('agent-1', 'data/usage.json'),
      ).resolves.toBe(false);
    });

    it('is false when the object is gone', async () => {
      send.mockRejectedValue(notFound());
      await expect(
        gateway.wasWrittenByRanch('agent-1', 'gone.md'),
      ).resolves.toBe(false);
    });
  });
});
