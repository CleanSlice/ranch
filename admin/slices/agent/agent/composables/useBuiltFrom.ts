import type { MaybeRefOrGetter } from 'vue';
import { builtFromText, ownerOnlyIngredient } from '#agent/utils/agentAccess';

type Ingredient = { assistantDependency?: boolean } | null | undefined;

/**
 * The signed-in viewer against a resource the Ranch assistant may be built
 * from (CLEAN-271): a template, a skill, a tool server, a model credential,
 * a knowledge base.
 *
 * `locked` is true when the API marked the resource `assistantDependency`
 * and the viewer is not the Owner: the page then shows it to read, says so
 * in one line (`note`), and offers no control the API would answer with
 * 403 `ASSISTANT_BUILT_FROM`. `lockedFor` is the same question for a row of
 * a list.
 *
 * The line names the assistant when it is among the agents this console
 * already holds, which is when the viewer has it; a viewer the assistant is
 * switched off for reads "the Ranch assistant". Nothing is fetched for it.
 */
export function useBuiltFrom(resource?: MaybeRefOrGetter<Ingredient>) {
  const auth = useAuthStore();
  const agentStore = useAgentStore();

  const lockedFor = (row: Ingredient): boolean =>
    ownerOnlyIngredient(auth.user?.role, row);
  const locked = computed(() => lockedFor(toValue(resource)));
  const note = computed(() =>
    builtFromText(agentStore.agents.find((agent) => agent.isAdmin)?.name ?? ''),
  );

  return { locked, lockedFor, note };
}
