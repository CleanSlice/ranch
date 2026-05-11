import { ApiProperty } from '@nestjs/swagger';
import { ApiKeyDto } from './apiKey.dto';

export class CreatedApiKeyDto {
  @ApiProperty({ type: ApiKeyDto })
  apiKey: ApiKeyDto;

  @ApiProperty({
    description:
      'Plaintext key. Returned exactly once at creation; the server only stores its hash.',
    example: 'rk_abcDEF...xyz',
  })
  key: string;
}
