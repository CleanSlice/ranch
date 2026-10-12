import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SaveNotificationDestinationDto {
  @ApiProperty({
    description:
      'A Slack incoming-webhook address (https://hooks.slack.com/services/…). A secret: it is stored and never returned.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  webhookUrl: string;
}

export class NotificationLastDeliveryDto {
  @ApiProperty()
  at: Date;

  @ApiProperty()
  ok: boolean;

  @ApiProperty({ nullable: true, type: String })
  error: string | null;
}

/** What may be seen of the destination. The address is not part of it. */
export class NotificationDestinationDto {
  @ApiProperty()
  configured: boolean;

  @ApiProperty({ nullable: true, enum: ['slack'] })
  kind: 'slack' | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'The last four characters of the address.',
  })
  hint: string | null;

  @ApiProperty({ nullable: true, type: String })
  updatedBy: string | null;

  @ApiProperty({ nullable: true, type: Date })
  updatedAt: Date | null;

  @ApiProperty({
    description:
      'false when ADMIN_URL is not set on the API: messages then carry no link to the console.',
  })
  consoleLinks: boolean;

  @ApiProperty({ nullable: true, type: NotificationLastDeliveryDto })
  lastDelivery: NotificationLastDeliveryDto | null;
}

export class TestDeliveryDto {
  @ApiProperty()
  delivered: boolean;

  @ApiProperty({ nullable: true, type: String })
  error: string | null;
}
