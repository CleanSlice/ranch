import { Injectable } from '@nestjs/common';
import { Prisma, StatFigure } from '@prisma/client';
import { IStatFigureData } from '../domain/figure.types';

@Injectable()
export class StatFigureMapper {
  toEntity(record: StatFigure): IStatFigureData {
    return {
      key: record.key,
      completeSince: record.completeSince,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(key: string, completeSince: Date): Prisma.StatFigureCreateManyInput {
    return { key, completeSince };
  }
}
