import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  NotFoundException,
  Param,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import { ErrorHandlingInterceptor } from '../error/error-handling.interceptor';
import { captureRequestError } from './sentry.client';
import { SentryExceptionFilter } from './sentry.filter';

jest.mock('./sentry.client', () => ({ captureRequestError: jest.fn() }));

const capture = jest.mocked(captureRequestError);

class SignedIn implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: unknown }>();
    req.user = { sub: 'user-1', email: 'ann@ranch.test' };
    return true;
  }
}

class Exploding implements CanActivate {
  canActivate(): boolean {
    throw new Error('guard blew up');
  }
}

@Controller('probe')
class ProbeController {
  @Get('missing')
  missing() {
    throw new NotFoundException('nope');
  }

  @Get('invalid')
  invalid() {
    throw new BadRequestException('bad input', {
      cause: new Error('parse'),
    });
  }

  @Get('agents/:agentId/boom')
  @UseGuards(SignedIn)
  boom(@Param('agentId') agentId: string) {
    throw new TypeError(`cannot read agent ${agentId}`);
  }

  @Get('down')
  down() {
    throw new HttpException('upstream down', 503);
  }

  @Get('guarded')
  @UseGuards(Exploding)
  guarded() {
    return 'unreachable';
  }
}

describe('SentryExceptionFilter', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.useLogger(false);
    app.useGlobalFilters(
      new SentryExceptionFilter(app.get(HttpAdapterHost).httpAdapter),
    );
    app.useGlobalInterceptors(new ErrorHandlingInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => capture.mockReset());

  const http = () => request(app.getHttpServer());

  it('hands a 404 over as itself and answers as before', async () => {
    const res = await http().get('/probe/missing').expect(404);

    expect(res.body).toEqual({
      message: 'nope',
      error: 'Not Found',
      statusCode: 404,
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0]).toBeInstanceOf(NotFoundException);
  });

  it('does not unwrap the cause of a 4xx', async () => {
    await http().get('/probe/invalid').expect(400);

    expect(capture.mock.calls[0][0]).toBeInstanceOf(BadRequestException);
  });

  it('reports the original error behind a wrapped 500', async () => {
    const res = await http().get('/probe/agents/a-42/boom').expect(500);

    expect(res.body).toEqual({
      statusCode: 500,
      message: 'cannot read agent a-42',
    });
    const [err, context] = capture.mock.calls[0];
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toBe('cannot read agent a-42');
    // The route pattern, never the URL; the opaque id, never the email.
    expect(context).toEqual({
      operation: 'GET /probe/agents/:agentId/boom',
      userId: 'user-1',
      agentId: 'a-42',
    });
  });

  it('passes a deliberate 5xx as itself', async () => {
    await http().get('/probe/down').expect(503);

    const [err, context] = capture.mock.calls[0];
    expect(err).toBeInstanceOf(HttpException);
    expect(context).toEqual({
      operation: 'GET /probe/down',
      userId: undefined,
      agentId: undefined,
    });
  });

  it('sees an error thrown by a guard, which no interceptor does', async () => {
    await http().get('/probe/guarded').expect(500);

    expect((capture.mock.calls[0][0] as Error).message).toBe('guard blew up');
  });

  it('labels a request that matched no route', async () => {
    await http().get('/nowhere').expect(404);

    expect(capture.mock.calls[0][1].operation).toBe('GET unmatched');
  });

  it('still answers when reporting throws', async () => {
    capture.mockImplementation(() => {
      throw new Error('tracker library broke');
    });

    const res = await http().get('/probe/down').expect(503);
    expect(res.body).toEqual({ statusCode: 503, message: 'upstream down' });
  });
});
