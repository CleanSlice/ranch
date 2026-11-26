import { IFigureDefinition } from '../figure.types';

/**
 * Messages by the hour (`ChatActivityHour`, chat slice): what conversations,
 * messages, people, agents that answered and channels over a period are read
 * from.
 *
 * It has no first record to point at. The hours are written live from the
 * release that adds them, so the figure is complete from the first boot of
 * that release; the registry reads a null here as "from now". The settle
 * pass fills earlier days from transcripts, but a compacted transcript cannot
 * give back what it no longer holds, so nothing before that boot is claimed
 * to be complete.
 */
export const activityFigure: IFigureDefinition = {
  key: 'activity',
  scopes: ['personal', 'installation'],
  firstRecord: () => Promise.resolve(null),
  rebuild: 'chat.settle',
};
