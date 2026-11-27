import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { IStatFigureData } from '../domain/figure.types';
import { IStatFigureGateway } from '../domain/statFigure.gateway';
import { StatFigureMapper } from './statFigure.mapper';

@Injectable()
export class StatFigureGateway extends IStatFigureGateway {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: StatFigureMapper,
  ) {
    super();
  }

  async findAll(): Promise<IStatFigureData[]> {
    const records = await this.prisma.statFigure.findMany({
      orderBy: { key: 'asc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async createIfAbsent(key: string, completeSince: Date): Promise<void> {
    // One statement, `INSERT … ON CONFLICT DO NOTHING`: an existing row is
    // not read first and cannot be overwritten, also when two processes boot
    // at once. An upsert with an empty update would still move `updatedAt`.
    await this.prisma.statFigure.createMany({
      data: [this.mapper.toCreate(key, completeSince)],
      skipDuplicates: true,
    });
  }

  async remove(key: string): Promise<void> {
    // `deleteMany` rather than `delete`: a row that is already gone is not
    // an error.
    await this.prisma.statFigure.deleteMany({ where: { key } });
  }
}
