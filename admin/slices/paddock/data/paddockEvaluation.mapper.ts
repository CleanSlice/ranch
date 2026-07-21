import type {
  IPaddockEvaluation,
  IPaddockEvaluationReport,
} from '../domain/paddockEvaluation.types';

/**
 * Maps the paddock-evaluation API onto domain shapes. Evaluations are deeply
 * nested, opaque read-only structures (judges, per-dimension scores, …), so
 * these are presence-validated casts rather than deep field maps.
 */
export class PaddockEvaluationMapper {
  toEvaluation(raw: unknown): IPaddockEvaluation | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    return typeof o.id === 'string'
      ? (o as unknown as IPaddockEvaluation)
      : null;
  }

  toList(raw: unknown): IPaddockEvaluation[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((e) => this.toEvaluation(e))
      .filter((e): e is IPaddockEvaluation => e !== null);
  }

  toReport(raw: unknown): IPaddockEvaluationReport | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    return {
      json: (o.json && typeof o.json === 'object' ? o.json : {}) as object,
      md: typeof o.md === 'string' ? o.md : '',
    };
  }
}
