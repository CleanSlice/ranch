import { IChatGateway } from '#/chat/domain/chat.gateway';
import { IFigureDefinition } from '../figure.types';

/**
 * The ratings a person gave to answers (`ChatFeedback`, chat slice). Read in
 * place: a rating is one row from the moment it is given, and it can be
 * changed or withdrawn, so a counter beside it would be a second truth to
 * keep equal to the first. Nothing to rebuild. Complete from the first
 * rating anybody gave.
 */
export function ratingsFigure(chats: IChatGateway): IFigureDefinition {
  return {
    key: 'ratings',
    scopes: ['personal'],
    firstRecord: () => chats.firstFeedbackAt(),
  };
}
