import { parsePurgeArgs } from './args';

describe('parsePurgeArgs', () => {
  it('is a dry run unless --delete is passed', () => {
    // Inverted from the other scripts on purpose: this one destroys chats.
    expect(parsePurgeArgs([]).dryRun).toBe(true);
  });

  it('scans every agent and leaves no limit by default', () => {
    expect(parsePurgeArgs([])).toEqual({
      agent: null,
      archive: null,
      dryRun: true,
      limit: null,
      concurrency: 8,
    });
  });

  it('parses the full flag set', () => {
    expect(
      parsePurgeArgs([
        '--agent',
        'agent-1',
        '--archive',
        '/tmp/purged-ru.jsonl',
        '--delete',
        '--limit',
        '20',
        '--concurrency',
        '4',
      ]),
    ).toEqual({
      agent: 'agent-1',
      archive: '/tmp/purged-ru.jsonl',
      dryRun: false,
      limit: 20,
      concurrency: 4,
    });
  });

  it('refuses to delete without an archive to write first', () => {
    // The archive is the whole reason this is reversible; deleting without
    // one is a different operation than the one that was agreed.
    expect(() => parsePurgeArgs(['--delete'])).toThrow(/--archive/);
  });

  it('allows --archive on a dry run so the path can be checked first', () => {
    expect(parsePurgeArgs(['--archive', '/tmp/a.jsonl'])).toEqual({
      agent: null,
      archive: '/tmp/a.jsonl',
      dryRun: true,
      limit: null,
      concurrency: 8,
    });
  });

  it('rejects an unknown flag instead of ignoring it', () => {
    expect(() => parsePurgeArgs(['--nope'])).toThrow(/--nope/);
  });

  it('rejects a limit that is not a positive integer', () => {
    expect(() => parsePurgeArgs(['--limit', 'many'])).toThrow(/--limit/);
    expect(() => parsePurgeArgs(['--limit', '0'])).toThrow(/--limit/);
  });

  it('rejects a flag whose value is missing', () => {
    expect(() => parsePurgeArgs(['--agent', '--delete'])).toThrow(/--agent/);
  });
});
