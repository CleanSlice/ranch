import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

/**
 * Translates multer's LIMIT_UNEXPECTED_FILE into something a caller can act
 * on. Multer keeps a per-field counter seeded with maxCount and raises that
 * code for every file past it - reusing the same error it raises for a
 * genuinely unknown field name, and naming the *expected* field in both
 * cases. So a 51st file arrives as "Unexpected field - files", which reads
 * like the field name is wrong when the real problem is the batch size.
 *
 * Must sit ahead of FilesInterceptor in the decorator list so it wraps it.
 */
@Injectable()
export class UploadLimitInterceptor implements NestInterceptor {
  constructor(
    private readonly field: string,
    private readonly maxFiles: number,
  ) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (!isUnexpectedField(error)) return throwError(() => error);
        return throwError(
          () =>
            new BadRequestException(
              `Too many files in one request, or a file was sent under the ` +
                `wrong field name. Send at most ${this.maxFiles} files as ` +
                `"${this.field}"; for larger sets use the from-archive route, ` +
                `which streams zip entries one at a time.`,
            ),
        );
      }),
    );
  }
}

function isUnexpectedField(error: unknown): boolean {
  return (
    error instanceof BadRequestException &&
    typeof error.message === 'string' &&
    error.message.includes('Unexpected field')
  );
}
