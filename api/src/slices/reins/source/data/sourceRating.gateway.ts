import { Injectable } from '@nestjs/common';
import { SourceRating } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ISourceRatingGateway } from '../domain/sourceRating.gateway';
import type {
  ISourceRatingData,
  IRateSourceInput,
} from '../domain/source.types';

@Injectable()
export class SourceRatingGateway extends ISourceRatingGateway {
  constructor(private prisma: PrismaService) {
    super();
  }

  async upsert(input: IRateSourceInput): Promise<ISourceRatingData> {
    const record = await this.prisma.sourceRating.upsert({
      where: {
        sourceId_messageId_authorId: {
          sourceId: input.sourceId,
          messageId: input.messageId,
          authorId: input.authorId,
        },
      },
      create: {
        sourceId: input.sourceId,
        messageId: input.messageId,
        authorId: input.authorId,
        rating: input.rating,
      },
      update: { rating: input.rating },
    });
    return toEntity(record);
  }

  async delete(
    sourceId: string,
    messageId: string,
    authorId: string,
  ): Promise<void> {
    await this.prisma.sourceRating.deleteMany({
      where: { sourceId, messageId, authorId },
    });
  }

  async findByAuthor(
    messageIds: string[],
    authorId: string,
  ): Promise<ISourceRatingData[]> {
    if (messageIds.length === 0) return [];
    const records = await this.prisma.sourceRating.findMany({
      where: { messageId: { in: messageIds }, authorId },
    });
    return records.map(toEntity);
  }
}

function toEntity(r: SourceRating): ISourceRatingData {
  return {
    id: r.id,
    sourceId: r.sourceId,
    messageId: r.messageId,
    authorId: r.authorId,
    rating: r.rating === -1 ? -1 : 1,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
