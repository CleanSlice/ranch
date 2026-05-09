import { SetMetadata } from '@nestjs/common';
import { ApiKeyScopeTypes } from '../../apiKey/domain';

/** Metadata key consumed by ScopesGuard. */
export const SCOPES_METADATA_KEY = 'scopes';

/**
 * Restrict a route to API-key callers that hold at least one of the listed
 * scopes. Combine with ApiKeyGuard so that req.apiKey is populated. The
 * `admin` scope is treated as a wildcard by ApiKeyService.hasScope.
 */
export const Scopes = (...scopes: ApiKeyScopeTypes[]) =>
  SetMetadata(SCOPES_METADATA_KEY, scopes);
