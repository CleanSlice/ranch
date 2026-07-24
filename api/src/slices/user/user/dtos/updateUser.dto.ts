import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateUserDto } from './createUser.dto';

/**
 * Mutable user fields *except* the role — role changes require the dedicated
 * UpdateUserRoleDto endpoint guarded by Owner.
 */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['role'] as const),
) {
  @ApiPropertyOptional({ enum: ['active', 'invited', 'disabled'] })
  @IsOptional()
  @IsEnum(['active', 'invited', 'disabled'])
  status?: 'active' | 'invited' | 'disabled';
}
