import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';

import { captureRequestError } from './sentry.client';
import { SERVER_FAILURE_STATUS } from './sentry.rules';

type ReportedRequest = Omit<Request, 'route'> & {
  user?: { sub?: unknown };
  route?: { path?: unknown };
};

/**
 * What to hand to the tracker. `ErrorHandlingInterceptor` wraps an unknown
 * error as a 500 and keeps the original as `cause`; the original has the
 * stack worth reading. A 4xx is passed as itself, whatever its cause, so the
 * rules see its status and drop it.
 */
function reportable(exception: unknown): unknown {
  if (
    exception instanceof HttpException &&
    exception.getStatus() >= SERVER_FAILURE_STATUS &&
    exception.cause
  ) {
    return exception.cause;
  }
  return exception;
}

/**
 * Reports a failed request, then lets Nest answer exactly as it would have
 * (CLEAN-218). A filter rather than an interceptor because guards and pipes
 * throw before any interceptor runs.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    try {
      if (host.getType() === 'http') {
        const req = host.switchToHttp().getRequest<ReportedRequest>();
        const route = req.route?.path;
        const userId = req.user?.sub;
        const agentId = req.params?.agentId;
        captureRequestError(reportable(exception), {
          operation: `${req.method} ${typeof route === 'string' ? route : 'unmatched'}`,
          userId: typeof userId === 'string' ? userId : undefined,
          agentId: typeof agentId === 'string' ? agentId : undefined,
        });
      }
    } catch {
      // Reporting never changes the response.
    }
    super.catch(exception, host);
  }
}
