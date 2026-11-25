import {
  detailOf,
  MAX_TOOL_SERVERS,
  parseReport,
  reasonOf,
  redactToolError,
  summaryOf,
} from './toolState';

const AT = '2026-11-20T09:10:52.368Z';

const server = (over: Record<string, unknown> = {}) => ({
  id: 'mcp-documents',
  name: 'Documents',
  state: 'retrying',
  since: AT,
  attempts: 14,
  lastError: 'HTTP 503',
  ...over,
});

const report = (over: Record<string, unknown> = {}) => ({
  phase: 'limited',
  since: AT,
  startedAt: '2026-11-20T09:09:52.000Z',
  servers: [server()],
  ...over,
});

describe('parseReport', () => {
  it('keeps a valid report', () => {
    expect(parseReport(report())).toEqual({
      phase: 'limited',
      since: AT,
      startedAt: '2026-11-20T09:09:52.000Z',
      servers: [
        {
          id: 'mcp-documents',
          name: 'Documents',
          state: 'retrying',
          since: AT,
          attempts: 14,
          lastError: 'HTTP 503',
        },
      ],
    });
  });

  it('a server without an id, and a connected one without an error', () => {
    const parsed = parseReport(
      report({
        phase: 'ready',
        servers: [
          server({
            id: undefined,
            state: 'connected',
            attempts: 0,
            lastError: 'stale',
          }),
        ],
      }),
    );
    expect(parsed?.servers[0]).toMatchObject({ id: null, lastError: null });
  });

  it('refuses unknown values, whole', () => {
    const bad: unknown[] = [
      null,
      'limited',
      [],
      report({ phase: 'broken' }),
      report({ since: 'yesterday' }),
      report({ startedAt: 7 }),
      report({ servers: 'Documents' }),
      report({ servers: [server({ state: 'sleeping' })] }),
      report({ servers: [server({ name: '  ' })] }),
      report({ servers: [server({ since: 'never' })] }),
      report({ servers: [server({ attempts: -1 })] }),
      report({ servers: [server({ attempts: 'many' })] }),
      report({ servers: [server(), 'Ranch'] }),
      report({
        servers: Array.from({ length: MAX_TOOL_SERVERS + 1 }, (_, i) =>
          server({ name: `S${i}` }),
        ),
      }),
    ];
    for (const raw of bad) expect(parseReport(raw)).toBeNull();
  });

  it('cuts what is too long', () => {
    const parsed = parseReport(
      report({
        servers: [
          server({ name: 'N'.repeat(500), lastError: 'e'.repeat(900) }),
        ],
      }),
    );
    expect(parsed?.servers[0].name.length).toBe(100);
    expect(parsed?.servers[0].lastError?.length).toBe(300);
  });
});

describe('redactToolError', () => {
  it('does not take the runtime at its word', () => {
    expect(
      redactToolError('401 for Authorization: Bearer abc.def-123'),
    ).not.toContain('abc.def-123');
    expect(
      redactToolError(
        'GET https://user:hunter2@api.test/mcp?token=s3cret failed',
      ),
    ).toBe('GET https://api.test/mcp failed');
    expect(redactToolError('<html><head><title>503</title></head>')).toBe(
      'the server answered with an error page',
    );
    expect(redactToolError('first line\n    at stack')).toBe('first line');
    expect(redactToolError(undefined)).toBeNull();
    expect(redactToolError('')).toBeNull();
  });
});

describe('summaryOf', () => {
  it('ready and no report are both nothing to say', () => {
    expect(summaryOf(null)).toBeNull();
    expect(
      summaryOf(parseReport(report({ phase: 'ready', servers: [] }))),
    ).toBeNull();
    expect(summaryOf(parseReport(report({ phase: 'connecting' })))).toBe(
      'connecting',
    );
    expect(summaryOf(parseReport(report()))).toBe('limited');
  });
});

describe('reasonOf', () => {
  it('names the servers and never the error', () => {
    expect(reasonOf(parseReport(report()))).toBe('Documents not connected');
    const two = parseReport(
      report({
        servers: [
          server(),
          server({
            id: 'mcp-ranch',
            name: 'Ranch',
            state: 'refused',
            lastError: 'HTTP 401',
          }),
          server({
            id: 'mcp-web',
            name: 'Web',
            state: 'connected',
            attempts: 0,
          }),
        ],
      }),
    );
    expect(reasonOf(two)).toBe(
      '2 tool servers not connected: Documents, Ranch',
    );
    expect(reasonOf(two)).not.toContain('401');
    expect(reasonOf(null)).toBeNull();
    expect(
      reasonOf(parseReport(report({ phase: 'ready', servers: [] }))),
    ).toBeNull();
  });
});

describe('detailOf', () => {
  it('is the record without the start time', () => {
    const detail = detailOf(parseReport(report()));
    expect(Object.keys(detail ?? {})).toEqual(['phase', 'since', 'servers']);
    expect(detail?.servers).toHaveLength(1);
    expect(detailOf(null)).toBeNull();
  });
});
