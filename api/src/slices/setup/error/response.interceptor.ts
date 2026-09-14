import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { RAW_RESPONSE_METADATA_KEY } from './rawResponse.decorator';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // A route that speaks an external protocol answers in that protocol's
    // shape, not in ours — see @RawResponse.
    const raw = this.reflector.getAllAndOverride<boolean>(
      RAW_RESPONSE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (raw) return next.handle();

    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
      })),
    );
  }
}
