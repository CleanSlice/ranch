import { ApiProperty } from '@nestjs/swagger';

export class TemplateDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  image: string;

  @ApiProperty()
  defaultConfig: Record<string, unknown>;

  @ApiProperty()
  defaultResources: { cpu: string; memory: string };

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
