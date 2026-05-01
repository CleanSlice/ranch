import { SetMetadata } from '@nestjs/common';

export const PUBLIC_METADATA_KEY = 'isPublic';

/**
 * Marks a route handler as public — JwtAuthGuard skips its check.
 * Use sparingly: anything tagged @Public() is reachable without a token.
 * Useful for SSE streams where EventSource cannot send Authorization headers.
 */
export const Public = () => SetMetadata(PUBLIC_METADATA_KEY, true);
