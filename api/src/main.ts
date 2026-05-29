import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';

import type { Request } from 'express';

import { AppModule } from './app.module';
import { ErrorHandlingInterceptor } from './slices/setup/error/error-handling.interceptor';
import { ResponseInterceptor } from './slices/setup/error/response.interceptor';
import { IAgentGateway } from '#/agent/agent/domain';

// Bun exits the process on unhandled rejection/exception by default. The
// @kubernetes/client-node Watch (KubePodGateway) leaks a DOMException
// TimeoutError after the ~5min server-side watch timeout, which is what
// has been crash-looping the api pod every ~6 minutes in prod. Swallow
// these globally so the watch reconnect logic in pod.gateway.ts has a
// chance to take over instead of bringing the whole API down.
process.on('unhandledRejection', (reason) => {
  console.error(
    '[unhandledRejection]',
    reason instanceof Error ? (reason.stack ?? reason) : reason,
  );
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.stack ?? err);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalInterceptors(new ErrorHandlingInterceptor());

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));

  // CORS is resolved per-request so the public Bridle widget routes
  // (`/api/agent/:agentId/...`) honour the SAME `allowedOrigins` the operator
  // configures on the agent in "Visibility & embed" — the exact list the
  // /ws/client handshake already enforces (see bridleClientWs.handler.ts).
  // Without this, the widget's socket connects (WS reads allowedOrigins) but
  // its HTTP transcript/message calls fall back to the static CORS_ORIGIN
  // allowlist, which can never include arbitrary customer shop domains.
  //
  // Resolution order for a request carrying an `Origin`:
  //   1. Origin in the static CORS_ORIGIN allowlist (dashboard, admin) → allow.
  //   2. Path is `/api/agent/:agentId/...` and Origin is in that agent's
  //      `allowedOrigins` → allow (reflects the operator's per-agent config).
  //   3. Otherwise → no CORS headers, browser blocks.
  // Requests without an Origin header (curl, server-to-server, same-origin)
  // are always allowed — CORS only governs browsers.
  const staticOrigins =
    process.env.CORS_ORIGIN?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) ?? [];

  if (staticOrigins.length === 0) {
    // No allowlist configured (local dev): reflect any origin.
    app.enableCors({ origin: true, credentials: true });
  } else {
    const agentGateway = app.get(IAgentGateway, { strict: false });
    const agentRoute = /^\/api\/agent\/([^/?#]+)/;
    // Short-TTL cache so transcript polling + preflight don't hammer the DB.
    // 30s is well under any realistic origin-edit-to-retry interval.
    const ALLOWED_TTL_MS = 30_000;
    const allowedCache = new Map<string, { origins: string[]; exp: number }>();

    const agentAllowsOrigin = async (
      agentId: string,
      origin: string,
    ): Promise<boolean> => {
      const cached = allowedCache.get(agentId);
      const now = Date.now();
      if (cached && cached.exp > now) return cached.origins.includes(origin);
      const agent = await agentGateway.findById(agentId).catch(() => null);
      const origins = agent?.allowedOrigins ?? [];
      allowedCache.set(agentId, { origins, exp: now + ALLOWED_TTL_MS });
      return origins.includes(origin);
    };

    app.enableCors(
      (req: Request, cb: (err: Error | null, options: object) => void) => {
        const resolve = (allow: boolean) =>
          cb(null, { origin: allow, credentials: true });
        const origin = req.headers.origin;
        if (!origin) return resolve(true);
        if (staticOrigins.includes(origin)) return resolve(true);

        const match = agentRoute.exec(req.url ?? '');
        if (!match) return resolve(false);
        const agentId = decodeURIComponent(match[1]);
        agentAllowsOrigin(agentId, origin)
          .then(resolve)
          .catch(() => resolve(false));
      },
    );
  }

  const config = new DocumentBuilder()
    .setTitle('Ranch API')
    .setDescription('Agent Deployment Platform API')
    .setVersion('1.0')
    .addBearerAuth(
      {
        description: 'JWT Bearer token',
        name: 'Authorization',
        bearerFormat: 'Bearer',
        scheme: 'Bearer',
        type: 'http',
        in: 'Header',
      },
      'defaultBearerAuth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  fs.writeFileSync('swagger-spec.json', JSON.stringify(document));
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`Ranch API running on: http://localhost:${port}`);
  console.log(`Swagger UI: http://localhost:${port}/api`);
}

bootstrap();
