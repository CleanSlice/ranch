import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ApiKeyService } from '../../apiKey/domain/apiKey.service';
import {
  ApiKeyScopeTypes,
  IApiKeyData,
} from '../../apiKey/domain/apiKey.types';
import { SCOPES_METADATA_KEY } from './scopes.decorator';

/**
 * Pairs with @Scopes(...). Allows the request when the API key on req carries
 * at least one of the required scopes (or the `admin` wildcard scope). Must
 * run AFTER ApiKeyGuard so that req.apiKey is set.
 */
@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Inject(forwardRef(() => ApiKeyService))
    private apiKeys: ApiKeyService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ApiKeyScopeTypes[]>(
      SCOPES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { apiKey?: IApiKeyData }>();
    if (!req.apiKey) throw new ForbiddenException('API key missing');

    const ok = required.some((s) => this.apiKeys.hasScope(req.apiKey!, s));
    if (!ok) throw new ForbiddenException('Insufficient API key scope');
    return true;
  }
}
