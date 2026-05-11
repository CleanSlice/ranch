import { Module, forwardRef } from '@nestjs/common';
import { ApiKeyController } from './apiKey.controller';
import { IApiKeyGateway } from './domain/apiKey.gateway';
import { ApiKeyService } from './domain/apiKey.service';
import { ApiKeyGateway } from './data/apiKey.gateway';
import { ApiKeyMapper } from './data/apiKey.mapper';
import { AuthModule } from '#/user/auth/auth.module';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [ApiKeyController],
  providers: [
    ApiKeyMapper,
    ApiKeyService,
    {
      provide: IApiKeyGateway,
      useClass: ApiKeyGateway,
    },
  ],
  exports: [IApiKeyGateway, ApiKeyService],
})
export class ApiKeyModule {}
