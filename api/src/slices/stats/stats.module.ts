import { Module } from '@nestjs/common';
import { AgentLimitModule } from '#/agent/limit/agentLimit.module';
import { UsageModule } from '#/usage/usage.module';
import { FigureRegistry, IStatFigureGateway } from './domain';
import { StatFigures } from './domain/figures';
import { StatFigureGateway } from './data/statFigure.gateway';
import { StatFigureMapper } from './data/statFigure.mapper';

// Statistics over a period (CLEAN-261, spec 038). The slice owns what a
// period is (`domain/period.ts`), the registry of figures and the one table
// that says since when each figure is complete. It holds no figures of its
// own: every fact stays in the slice that records it and is read through that
// slice's public gateway.
//
// PrismaService comes from the global PrismaModule. The registry and the
// gateway are exported for the services and tools that will read figures.
//
// The imports are the slices whose facts the registered figures stand for
// (`domain/figures/`). Nothing imports this module but the app, so they
// cannot close a cycle.
@Module({
  imports: [AgentLimitModule, UsageModule],
  providers: [
    StatFigureMapper,
    { provide: IStatFigureGateway, useClass: StatFigureGateway },
    FigureRegistry,
    StatFigures,
  ],
  exports: [FigureRegistry, IStatFigureGateway],
})
export class StatsModule {}
