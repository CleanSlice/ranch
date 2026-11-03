import { Controller, Get, Req } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import * as request from 'supertest';

import {
  DEFAULT_TRUSTED_PROXY_HOPS,
  resolveTrustedProxyHops,
  trustLoadBalancer,
} from './trust-proxy';

@Controller('probe')
class ProbeController {
  @Get()
  read(@Req() req: Request) {
    return { ip: req.ip };
  }
}

async function createApp(
  raw: string | undefined,
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  trustLoadBalancer(app, raw);
  await app.init();
  return app;
}

describe('resolveTrustedProxyHops', () => {
  it('defaults to one hop when unset or empty', () => {
    expect(resolveTrustedProxyHops(undefined)).toBe(DEFAULT_TRUSTED_PROXY_HOPS);
    expect(resolveTrustedProxyHops('')).toBe(DEFAULT_TRUSTED_PROXY_HOPS);
    expect(resolveTrustedProxyHops('  ')).toBe(DEFAULT_TRUSTED_PROXY_HOPS);
  });

  it('accepts zero and whole numbers, ignoring surrounding spaces', () => {
    expect(resolveTrustedProxyHops('0')).toBe(0);
    expect(resolveTrustedProxyHops('2')).toBe(2);
    expect(resolveTrustedProxyHops(' 3 ')).toBe(3);
  });

  it.each(['-1', '1.5', 'one', '1 2'])('refuses %p at boot', (raw) => {
    expect(() => resolveTrustedProxyHops(raw)).toThrow('TRUSTED_PROXY_HOPS');
  });
});

describe('trustLoadBalancer', () => {
  it('reads the client address the load balancer appended', async () => {
    const app = await createApp('1');
    try {
      const res = await request(app.getHttpServer())
        .get('/probe')
        .set('X-Forwarded-For', '203.0.113.7');
      expect(res.body.ip).toBe('203.0.113.7');
    } finally {
      await app.close();
    }
  });

  it('ignores an address the client put in front of the balancer entry', async () => {
    const app = await createApp('1');
    try {
      const res = await request(app.getHttpServer())
        .get('/probe')
        .set('X-Forwarded-For', '6.6.6.6, 203.0.113.7');
      expect(res.body.ip).toBe('203.0.113.7');
    } finally {
      await app.close();
    }
  });

  it('with zero hops, a direct request ignores X-Forwarded-For altogether', async () => {
    const app = await createApp('0');
    try {
      const res = await request(app.getHttpServer())
        .get('/probe')
        .set('X-Forwarded-For', '203.0.113.7');
      expect(res.body.ip).not.toBe('203.0.113.7');
    } finally {
      await app.close();
    }
  });
});
