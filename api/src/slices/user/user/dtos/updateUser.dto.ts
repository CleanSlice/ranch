import {
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateUserDto } from './createUser.dto';

/**
 * Mutable user fields *except* roles — role changes require the dedicated
 * UpdateUserRolesDto endpoint guarded by Owner.
 */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['roles'] as const),
) {
  @ApiPropertyOptional({ enum: ['active', 'invited', 'disabled'] })
  @IsOptional()
  @IsEnum(['active', 'invited', 'disabled'])
  status?: 'active' | 'invited' | 'disabled';
}
