import { ApiProperty } from '@nestjs/swagger';

export class InitStatusDto {
  @ApiProperty()
  requiresInit: boolean;
}
