import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BridlePartTypes } from '../domain';

export class BridleTextPartDto {
  @ApiProperty({ enum: BridlePartTypes, example: BridlePartTypes.Text })
  @IsEnum(BridlePartTypes)
  type: BridlePartTypes.Text;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  text: string;
}

export class BridleImagePartDto {
  @ApiProperty({ enum: BridlePartTypes, example: BridlePartTypes.Image })
  @IsEnum(BridlePartTypes)
  type: BridlePartTypes.Image;

  @ApiProperty({ description: 'Base64-encoded image data' })
  @IsString()
  @IsNotEmpty()
  base64: string;

  @ApiProperty({ description: 'MIME type', example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  mediaType: string;
}

export class BridleFilePartDto {
  @ApiProperty({ enum: BridlePartTypes, example: BridlePartTypes.File })
  @IsEnum(BridlePartTypes)
  type: BridlePartTypes.File;

  @ApiProperty({ description: 'File URL' })
  @IsString()
  @IsNotEmpty()
  url: string;

  @ApiProperty({ description: 'File name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'MIME type' })
  @IsString()
  @IsOptional()
  mimeType?: string;
}

export class SendMessageDto {
  @ApiProperty({ description: 'Message text (plain-text shorthand)' })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiPropertyOptional({
    description: 'Rich content parts. If omitted, built from text + images.',
    type: [BridleTextPartDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BridleTextPartDto, {
    discriminator: {
      property: 'type',
      subTypes: [
        { value: BridleTextPartDto, name: 'text' },
        { value: BridleImagePartDto, name: 'image' },
        { value: BridleFilePartDto, name: 'file' },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  parts?: Array<BridleTextPartDto | BridleImagePartDto | BridleFilePartDto>;

  @ApiPropertyOptional({
    description: 'Attached images (legacy — prefer parts)',
    type: [BridleImagePartDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BridleImagePartDto)
  images?: BridleImagePartDto[];
}
