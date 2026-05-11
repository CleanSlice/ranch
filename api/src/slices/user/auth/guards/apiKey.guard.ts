import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiKeyService } from '../../apiKey/domain/apiKey.service';
import { IApiKeyData } from '../../apiKey/domain/apiKey.types';

/**
 * Verifies `Authorization: Bearer rk_<key>` and stores the verified row on
 * `req.apiKey` for downstream code (controllers, ScopesGuard) to consume.
 * Throws 401 on missing, malformed, unknown, or expired keys.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Inject(forwardRef(() => ApiKeyService))
    private apiKeys: ApiKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { apiKey?: IApiKeyData }>();
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Missing API key');
    }
    const apiKey = await this.apiKeys.verify(token);
    if (!apiKey) throw new UnauthorizedException('Invalid or expired API key');
    req.apiKey = apiKey;
    return true;
  }
}
