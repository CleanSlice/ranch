import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { AppModule } from './app.module';

async function generate() {
  const app = await NestFactory.create(AppModule, {
    logger: false,
    bufferLogs: true,
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
  writeFileSync('./swagger-spec.json', JSON.stringify(document, null, 2));

  try {
    await app.close();
  } catch {
    // ignore
  }

  process.exit(0);
}

generate().catch((err) => {
  console.error('[swagger] generation failed:', err);
  process.exit(1);
});
