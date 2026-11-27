import { IFigureDefinition } from '../figure.types';

/**
 * The sources answers cited (`ChatMessageSource`, chat slice). Read in
 * place: the hub writes one row per cited source when the answer arrives,
 * and that row is the record, kept even after the conversation or the
 * source is gone. Nothing to rebuild, and no first record: no citation
 * before some day means no answer cited anything before it, so the figure
 * never carries a "counted since" note (CLEAN-262).
 */
export const citationsFigure: IFigureDefinition = {
  key: 'citations',
  scopes: ['personal'],
};
