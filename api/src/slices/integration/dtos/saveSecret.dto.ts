import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SaveSecretDto {
  @ApiProperty({
    description:
      'Raw credential value (API key, token, etc.). Stored in the per-user secret store under a key derived from (service, accountKey). Never echoed back through the API once written.',
    maxLength: 4096,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  value: string;
}
