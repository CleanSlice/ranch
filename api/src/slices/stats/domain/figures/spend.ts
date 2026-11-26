import { IUsageGateway } from '#/usage/domain';
import { IFigureDefinition } from '../figure.types';

/**
 * Tokens, model calls and estimated cost (`Usage`, usage slice). Read in
 * place: the day rows the agents report are the source, so there is nothing
 * to rebuild. Complete from the first day any agent reported.
 */
export function spendFigure(usage: IUsageGateway): IFigureDefinition {
  return {
    key: 'spend',
    scopes: ['installation'],
    firstRecord: () => usage.firstRecordAt(),
  };
}
