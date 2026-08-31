import { ApiProperty } from '@nestjs/swagger';
import { BridleAttachmentKinds } from '../domain';

/** What the upload endpoint returns; also the shape a message carries. */
export class BridleAttachmentDto {
  @ApiProperty({ description: 'Attachment id, also the storage key stem' })
  id: string;

  @ApiProperty({ description: 'Original filename, for display' })
  name: string;

  @ApiProperty({ description: 'Resolved MIME type', example: 'image/png' })
  mimeType: string;

  @ApiProperty({ description: 'Size in bytes' })
  size: number;

  @ApiProperty({
    enum: BridleAttachmentKinds,
    description:
      'How the attachment reaches the agent: image content, inlined text, or a named reference',
  })
  kind: BridleAttachmentKinds;

  @ApiProperty({
    description:
      'Path of the authenticated download route. Never a direct storage URL.',
  })
  url: string;

  @ApiProperty({
    description:
      'False when the agent will see only the file name, not its contents',
  })
  readableByAgent: boolean;
}
