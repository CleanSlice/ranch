import { SetMetadata } from '@nestjs/common';

export const PUBLIC_METADATA_KEY = 'isPublic';

/**
 * Marks a route handler (or a whole controller) as public — JwtAuthGuard,
 * registered as the global APP_GUARD, skips its check (CLEAN-175).
 *
 * It lifts the JWT requirement and nothing else: a route that also carries
 * ApiKeyGuard, BridleApiKeyGuard, a peer guard or verifies a token by hand is
 * still authenticated by that guard. Use it for exactly those routes, for the
 * handful that must work before login (health, setup, login, refresh,
 * logout), and for SSE streams where EventSource cannot send a header.
 *
 * Every use is pinned by `publicRoutes.spec.ts` in this folder: adding or
 * removing one means updating that list and saying in the PR why the caller
 * cannot hold a token.
 */
export const Public = () => SetMetadata(PUBLIC_METADATA_KEY, true);
