import { SetMetadata } from '@nestjs/common';
import { UserRoleTypes } from '../../user/domain';

/** Metadata key consumed by RolesGuard. */
export const ROLES_METADATA_KEY = 'roles';

/**
 * Restrict a route to users that have at least one of the listed roles.
 * Combine with JwtAuthGuard so that req.user is populated.
 */
export const Roles = (...roles: UserRoleTypes[]) =>
  SetMetadata(ROLES_METADATA_KEY, roles);
