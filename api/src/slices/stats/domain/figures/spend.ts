import { IFigureDefinition } from '../figure.types';

/**
 * Tokens, model calls and estimated cost (`Usage`, usage slice). Read in
 * place: the day rows the agents report are the source, so there is nothing
 * to rebuild. No first record either: no row before some day means no agent
 * reported usage before it, so the figure never carries a "counted since"
 * note (CLEAN-262).
 */
export const spendFigure: IFigureDefinition = {
  key: 'spend',
  scopes: ['installation'],
};
