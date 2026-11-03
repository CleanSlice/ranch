import { Controller, Get, Req } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import * as request from 'supertest';

import { trustLoadBalancer } from './trust-proxy';

@Controller('probe')
class ProbeController {
  @Get()
  read(@Req() req: Request) {
    return { ip: req.ip };
  }
}

async function createApp(trust: boolean): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  if (trust) trustLoadBalancer(app);
  await app.init();
  return app;
}

describe('trustLoadBalancer', () => {
  it('reads the client address the load balancer appended', async () => {
    const app = await createApp(true);
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
    const app = await createApp(true);
    try {
      const res = await request(app.getHttpServer())
        .get('/probe')
        .set('X-Forwarded-For', '6.6.6.6, 203.0.113.7');
      expect(res.body.ip).toBe('203.0.113.7');
    } finally {
      await app.close();
    }
  });

  it('without the setting, reports the balancer address instead of the client', async () => {
    const app = await createApp(false);
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
