import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateChatFeedbackDto {
  @ApiProperty({ description: 'Event.id of the rated assistant message' })
  @IsString()
  messageId: string;

  @ApiProperty({ enum: [1, -1], description: '1 = 👍, -1 = 👎' })
  @IsInt()
  @IsIn([1, -1])
  rating: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

export class ChatFeedbackDto {
  @ApiProperty() id: string;
  @ApiProperty() messageId: string;
  @ApiProperty({ enum: [1, -1] }) rating: number;
  @ApiPropertyOptional({ nullable: true }) comment: string | null;
  @ApiProperty({ example: 'admin' }) source: string;
  @ApiPropertyOptional({ nullable: true }) authorId: string | null;
  @ApiProperty() createdAt: Date;
}
