import { NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Readable, Writable } from 'stream';
import type { Response } from 'express';
import { FileController } from './file.controller';
import { OpenLinkService } from './domain/openLink.service';
import type { IFileGateway } from './domain/file.gateway';
import type { IAgentGateway } from '#/agent/agent/domain';
import type { IBridleGateway } from '#/bridle/domain';
import type { SyncGuardService } from './domain/syncGuard.service';
import { isActiveContentType, rawResponseHeaders } from './domain/rawHeaders';

// The raw route (CLEAN-112) serves whatever an agent wrote — including
// .html / .js / .svg — from the API origin. These specs pin the headers that
// keep such a file from ever running as active content.

interface FakeRes {
  headers: Record<string, string>;
  statusCode: number;
  body: string | null;
  piped: boolean;
}

class FakeResponse extends Writable implements FakeRes {
  headers: Record<string, string> = {};
  statusCode = 200;
  body: string | null = null;
  piped = false;

  _write(_chunk: unknown, _enc: string, cb: () => void) {
    this.piped = true;
    cb();
  }

  setHeader(name: string, value: string) {
    this.headers[name] = value;
    return this;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  type() {
    return this;
  }

  send(body: string) {
    this.body = body;
    return this;
  }
}

function fakeResponse(): FakeRes & Response {
  return new FakeResponse() as unknown as FakeRes & Response;
}

function makeController(
  streams: Record<string, { kind: 'text' | 'binary'; contentType: string }>,
) {
  const openLinks = new OpenLinkService(new JwtService({ secret: 'test' }));
  const fileGateway = {
    streamRaw: async (_agentId: string, path: string) => {
      const entry = streams[path];
      if (!entry) throw new NotFoundException('File not found');
      const body = Readable.from([Buffer.from('<html></html>')]);
      return {
        body,
        size: 13,
        contentType: entry.contentType,
        kind: entry.kind,
      };
    },
  } as unknown as IFileGateway;
  const agentGateway = {
    findById: async (id: string) => (id === 'agent-1' ? { id } : null),
  } as unknown as IAgentGateway;
  const controller = new FileController(
    agentGateway,
    fileGateway,
    {} as IBridleGateway,
    {} as SyncGuardService,
    openLinks,
  );
  return { controller, openLinks };
}

describe('GET /agents/:id/files/raw — headers', () => {
  const { controller, openLinks } = makeController({
    'SOUL.md': { kind: 'text', contentType: 'text/markdown; charset=utf-8' },
    'workspace/page.html': {
      kind: 'text',
      contentType: 'text/html; charset=utf-8',
    },
    'data/photo.png': { kind: 'binary', contentType: 'image/png' },
    'data/logo.svgz': { kind: 'binary', contentType: 'image/svg+xml' },
  });

  const expectHardening = (res: FakeRes) => {
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Content-Security-Policy']).toBe(
      "sandbox; default-src 'none'",
    );
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(res.headers['Referrer-Policy']).toBe('no-referrer');
  };

  it('serves a text file inline as plain text', async () => {
    const { token } = openLinks.mint('agent-1', 'SOUL.md', 'text');
    const res = fakeResponse();
    await controller.raw('agent-1', token, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(res.headers['Content-Disposition']).toBe(
      'inline; filename="SOUL.md"',
    );
    expect(res.headers['Content-Length']).toBe('13');
    expectHardening(res);
  });

  it('serves an .html file as plain text, never as a document', async () => {
    const { token } = openLinks.mint('agent-1', 'workspace/page.html', 'text');
    const res = fakeResponse();
    await controller.raw('agent-1', token, res);
    expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(res.headers['Content-Disposition']).toBe(
      'inline; filename="page.html"',
    );
    expectHardening(res);
  });

  it('serves a binary file as an attachment with its stored type', async () => {
    const { token } = openLinks.mint('agent-1', 'data/photo.png', 'binary');
    const res = fakeResponse();
    await controller.raw('agent-1', token, res);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.headers['Content-Disposition']).toBe(
      'attachment; filename="photo.png"',
    );
    expectHardening(res);
  });

  it('downgrades renderable binary types (svg) to octet-stream', async () => {
    const { token } = openLinks.mint('agent-1', 'data/logo.svgz', 'binary');
    const res = fakeResponse();
    await controller.raw('agent-1', token, res);
    expect(res.headers['Content-Type']).toBe('application/octet-stream');
    expect(res.headers['Content-Disposition']).toBe(
      'attachment; filename="logo.svgz"',
    );
  });

  it('answers 401 for a token minted for another agent', async () => {
    const { token } = openLinks.mint('agent-2', 'SOUL.md', 'text');
    const res = fakeResponse();
    await controller.raw('agent-1', token, res);
    expect(res.statusCode).toBe(401);
  });

  it('answers 401 for garbage', async () => {
    const res = fakeResponse();
    await controller.raw('agent-1', 'nope', res);
    expect(res.statusCode).toBe(401);
  });

  it('answers a plain-text 404 when the file is gone', async () => {
    const { token } = openLinks.mint('agent-1', 'gone.md', 'text');
    const res = fakeResponse();
    await controller.raw('agent-1', token, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('File not found');
  });
});

describe('POST /agents/:id/files/open-link', () => {
  it('returns a relative raw url when PUBLIC_API_URL is unset', async () => {
    const prev = process.env.PUBLIC_API_URL;
    delete process.env.PUBLIC_API_URL;
    const { controller } = makeController({});
    const out = await controller.openLink('agent-1', { path: 'SOUL.md' });
    expect(out.url.startsWith('/agents/agent-1/files/raw?token=')).toBe(true);
    expect(new Date(out.expiresAt).getTime()).toBeGreaterThan(Date.now());
    if (prev !== undefined) process.env.PUBLIC_API_URL = prev;
  });

  it('prefixes PUBLIC_API_URL without a double slash', async () => {
    const prev = process.env.PUBLIC_API_URL;
    process.env.PUBLIC_API_URL = 'https://api.example.test/';
    const { controller } = makeController({});
    const out = await controller.openLink('agent-1', { path: 'SOUL.md' });
    expect(
      out.url.startsWith(
        'https://api.example.test/agents/agent-1/files/raw?token=',
      ),
    ).toBe(true);
    if (prev === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = prev;
  });

  it('refuses an unknown agent', async () => {
    const { controller } = makeController({});
    await expect(
      controller.openLink('nope', { path: 'SOUL.md' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('rawResponseHeaders', () => {
  it('flags active content types', () => {
    expect(isActiveContentType('image/svg+xml')).toBe(true);
    expect(isActiveContentType('text/html; charset=utf-8')).toBe(true);
    expect(isActiveContentType('application/xhtml+xml')).toBe(true);
    expect(isActiveContentType('text/javascript')).toBe(true);
    expect(isActiveContentType('image/png')).toBe(false);
    expect(isActiveContentType('application/pdf')).toBe(false);
  });

  it('sanitises the filename', () => {
    const h = rawResponseHeaders('a/b"c\n.txt', 'text', 'text/plain', 1);
    expect(h['Content-Disposition']).toBe('inline; filename="b_c_.txt"');
  });
});
