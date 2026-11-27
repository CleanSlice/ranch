import { IFigureDefinition } from '../figure.types';

/**
 * The ratings people gave to answers (`ChatFeedback`, chat slice): a
 * person's own in "How agents helped", and per agent in the installation's
 * quality block, which reads them through `feedbackByAgent` (CLEAN-265).
 * Read in place: a rating is one row from the moment it is given, and it
 * can be changed or withdrawn, so a counter beside it would be a second
 * truth to keep equal to the first. Nothing to rebuild, and no first
 * record: no rating before some day means nobody rated before it, so the
 * figure never carries a "counted since" note (CLEAN-262).
 */
export const ratingsFigure: IFigureDefinition = {
  key: 'ratings',
  scopes: ['personal', 'installation'],
};
