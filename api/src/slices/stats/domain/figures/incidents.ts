import { IFigureDefinition } from '../figure.types';

/**
 * Incidents of the agents (`AgentIncident`, agent/event slice): what the
 * health block of the installation lists. Read in place: an incident is one
 * row with its opening time from the moment it opens, and the same row
 * changes when it closes, so a counter beside it would have to be told of
 * both and would still not know which ones are open. Nothing to rebuild, and
 * no first record: no incident before some day means no agent failed before
 * it, so the figure never carries a "counted since" note (CLEAN-262).
 */
export const incidentsFigure: IFigureDefinition = {
  key: 'incidents',
  scopes: ['installation'],
};
