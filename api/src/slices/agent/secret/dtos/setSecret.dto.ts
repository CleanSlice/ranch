import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SetSecretDto {
  @ApiProperty({
    example: 'instagram:password',
    description:
      'Secret key. Upsert: an existing key is overwritten, a new key is created.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  key!: string;

  @ApiProperty({ example: 'sk-...', description: 'Secret value to store.' })
  @IsString()
  @IsNotEmpty()
  value!: string;
}
