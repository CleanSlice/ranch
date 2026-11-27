import { Injectable, OnModuleInit } from '@nestjs/common';
import { AgentLimitService } from '#/agent/limit/domain';
import { IDelegationGateway } from '#/agent/peer/domain/delegation.gateway';
import { IChatGateway } from '#/chat/domain/chat.gateway';
import { ChatSourceService } from '#/chat/domain/chatSource.service';
import { IUsageGateway } from '#/usage/domain';
import { FigureRegistry } from '../figureRegistry';
import { activityFigure } from './activity';
import { citationsFigure } from './citations';
import { handoversFigure } from './handovers';
import { ratingsFigure } from './ratings';
import { refusalsFigure } from './refusals';
import { spendFigure } from './spend';

export {
  activityFigure,
  citationsFigure,
  handoversFigure,
  ratingsFigure,
  refusalsFigure,
  spendFigure,
};

/**
 * The list of figures. Adding one is a file in this folder and a line here
 * (docs/statistics.md, "Adding a figure"); nothing that already exists is
 * edited.
 *
 * Registered in `onModuleInit`: the registry writes the missing `StatFigure`
 * rows in `onApplicationBootstrap`, which Nest runs after every module has
 * initialised, so by then each owning slice has finished its own start-up
 * (the limit service has rebuilt its days) and can say how far back it goes.
 */
@Injectable()
export class StatFigures implements OnModuleInit {
  constructor(
    private readonly registry: FigureRegistry,
    private readonly limits: AgentLimitService,
    private readonly usage: IUsageGateway,
    private readonly chats: IChatGateway,
    private readonly sources: ChatSourceService,
    private readonly delegations: IDelegationGateway,
  ) {}

  onModuleInit(): void {
    this.registry.register(activityFigure);
    this.registry.register(refusalsFigure(this.limits));
    this.registry.register(spendFigure(this.usage));
    // What "How agents helped" shows a person (CLEAN-258).
    this.registry.register(ratingsFigure(this.chats));
    this.registry.register(citationsFigure(this.sources));
    this.registry.register(handoversFigure(this.delegations));
  }
}
