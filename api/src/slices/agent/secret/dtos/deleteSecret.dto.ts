import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DeleteSecretDto {
  @ApiProperty({
    example: 'instagram:password',
    description: 'Secret key to delete. No-op if the key does not exist.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  key!: string;
}
