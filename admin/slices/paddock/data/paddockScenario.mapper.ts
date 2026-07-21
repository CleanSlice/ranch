import type {
  ICreatePaddockScenario,
  IPaddockScenario,
} from '../domain/paddockScenario.types';

/**
 * Maps the paddock-scenario API onto domain shapes. Scenarios carry nested
 * message/criteria/setup structures; these are presence-validated casts.
 */
export class PaddockScenarioMapper {
  toScenario(raw: unknown): IPaddockScenario | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    return typeof o.id === 'string' ? (o as unknown as IPaddockScenario) : null;
  }

  toList(raw: unknown): IPaddockScenario[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((s) => this.toScenario(s))
      .filter((s): s is IPaddockScenario => s !== null);
  }

  // `generate` returns a scenario *draft* (create-input shape), not a persisted
  // scenario — presence-validated cast.
  toCreateInput(raw: unknown): ICreatePaddockScenario | null {
    return raw && typeof raw === 'object'
      ? (raw as ICreatePaddockScenario)
      : null;
  }
}
