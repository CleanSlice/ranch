import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';

import { AppModule } from './app.module';
import { ErrorHandlingInterceptor } from './slices/setup/error/error-handling.interceptor';
import { ResponseInterceptor } from './slices/setup/error/response.interceptor';

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

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') || '*',
    credentials: true,
  });

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
