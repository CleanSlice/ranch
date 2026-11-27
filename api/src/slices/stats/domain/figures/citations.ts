import { ChatSourceService } from '#/chat/domain/chatSource.service';
import { IFigureDefinition } from '../figure.types';

/**
 * The sources answers cited (`ChatMessageSource`, chat slice). Read in
 * place: the hub writes one row per cited source when the answer arrives,
 * and that row is the record, kept even after the conversation or the
 * source is gone. Nothing to rebuild. Complete from the first citation.
 */
export function citationsFigure(sources: ChatSourceService): IFigureDefinition {
  return {
    key: 'citations',
    scopes: ['personal'],
    firstRecord: () => sources.firstRecordAt(),
  };
}
