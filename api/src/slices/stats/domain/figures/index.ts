import { Injectable, OnModuleInit } from '@nestjs/common';
import { AgentLimitService } from '#/agent/limit/domain';
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
 * rows of the recorded figures in `onApplicationBootstrap`, which Nest runs
 * after every module has initialised, so by then each owning slice has
 * finished its own start-up (the limit service has rebuilt its days) and can
 * say how far back its table goes. Only a recorded figure is asked that,
 * which is why the limit service is the one dependency here: a figure read
 * in place is a constant.
 */
@Injectable()
export class StatFigures implements OnModuleInit {
  constructor(
    private readonly registry: FigureRegistry,
    private readonly limits: AgentLimitService,
  ) {}

  onModuleInit(): void {
    // Recorded: each has a `StatFigure` row.
    this.registry.register(activityFigure);
    this.registry.register(refusalsFigure(this.limits));
    // Read in place: no row and no note (CLEAN-262).
    this.registry.register(spendFigure);
    // What "How agents helped" shows a person (CLEAN-258).
    this.registry.register(ratingsFigure);
    this.registry.register(citationsFigure);
    this.registry.register(handoversFigure);
  }
}
