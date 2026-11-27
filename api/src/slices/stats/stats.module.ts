import { Module } from '@nestjs/common';
import { AgentModule } from '#/agent/agent/agent.module';
import { AgentLimitModule } from '#/agent/limit/agentLimit.module';
import { PeerModule } from '#/agent/peer/peer.module';
import { ChatModule } from '#/chat/chat.module';
import { LlmModule } from '#/llm/llm.module';
import { UsageModule } from '#/usage/usage.module';
import {
  FigureRegistry,
  IStatFigureGateway,
  PersonalStatsService,
} from './domain';
import { StatFigures } from './domain/figures';
import { StatFigureGateway } from './data/statFigure.gateway';
import { StatFigureMapper } from './data/statFigure.mapper';
import { MyStatsController } from './myStats.controller';
import { StatsTool } from './stats.tool';

// Statistics over a period (CLEAN-261 and CLEAN-258, spec 038). The slice
// owns what a period is (`domain/period.ts`), the registry of figures, the
// one table that says since when each figure is complete, and the views
// built from them: a person's own (`GET /me/stats`, `get_my_stats`). It
// holds no figures of its own: every fact stays in the slice that records it
// and is read through that slice's public gateway or service.
//
// PrismaService comes from the global PrismaModule, AgentAccessService from
// the global AgentAccessModule, and the JWT guard's dependencies from the
// global AuthModule.
//
// The imports are the slices whose facts are read: activity, ratings and
// citations (chat), hand-overs (agent/peer), calls per model (usage), limit
// refusals (agent/limit), agent names (agent) and the model each runs now
// (llm). Nothing imports this module but the app, so they cannot close a
// cycle, and it is listed after all of them in app.module.ts, so each is
// defined by the time this file is read.
@Module({
  imports: [
    AgentLimitModule,
    UsageModule,
    ChatModule,
    PeerModule,
    AgentModule,
    LlmModule,
  ],
  controllers: [MyStatsController],
  providers: [
    StatFigureMapper,
    { provide: IStatFigureGateway, useClass: StatFigureGateway },
    FigureRegistry,
    StatFigures,
    PersonalStatsService,
    // MCP tool: get_my_stats. Discovered by the #mcp registry like every
    // @Tool provider.
    StatsTool,
  ],
  exports: [FigureRegistry, IStatFigureGateway],
})
export class StatsModule {}
