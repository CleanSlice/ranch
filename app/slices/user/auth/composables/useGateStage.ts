import type { InjectionKey, Ref } from 'vue';

/**
 * Where the visitor is on the way into the hub, as the sign-in gate shows
 * it: the route "you → RANCH hub → your agents" lights up as the form is
 * filled and submitted. Purely presentational — it mirrors the form's own
 * state and never claims a backend event the form did not see.
 *
 *  - idle        nothing typed yet
 *  - filling     a field has focus or a value
 *  - connecting  the request is in flight
 *  - failed      the API said no (the form shows the message)
 */
export type GateStage = 'idle' | 'filling' | 'connecting' | 'failed';

export const GATE_STAGE: InjectionKey<Ref<GateStage>> = Symbol('gate-stage');

/** The layout owns the stage; the form reports into it. */
export function provideGateStage() {
  const stage = ref<GateStage>('idle');
  provide(GATE_STAGE, stage);
  return stage;
}

/**
 * The form side. Outside the gate (the session-ended dialog renders the
 * same form inside the console) there is nothing to report to, and the
 * setter is a no-op.
 */
export function useGateStage() {
  const stage = inject(GATE_STAGE, null);
  function set(next: GateStage) {
    if (stage) stage.value = next;
  }
  return { stage, set };
}
