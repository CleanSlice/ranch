import type { MaybeRefOrGetter } from 'vue';
import { useEventListener } from '@vueuse/core';
import {
  settingsSectionOf,
  toAgentTab,
} from '#agent/components/agent/workspace/sections';
import { registerTabLeaveGuard } from '#agent/composables/useAgentTab';

export interface IUnsavedGuardOptions {
  /** How many changes would be lost — said in the question. */
  count?: MaybeRefOrGetter<number>;
  /** Called when the operator chooses to discard, before the way out is
   *  taken. Pass the draft's `discard` so the edits are really gone — also
   *  when the page then stays mounted. */
  onDiscard?: () => void;
}

export interface IUnsavedGuard {
  /**
   * Asks "Discard unsaved changes?" when there are any. `true`: nothing to
   * lose, or the operator chose to discard. `false`: keep editing. For a way
   * out no route guard sees — this is what `useAgentTab().setTab` awaits.
   */
  confirmLeave(): Promise<boolean>;
}

/** What Settings has on screen for a `?tab=` value; `chat` for the chat. */
function screenOf(tab: unknown): string {
  return settingsSectionOf(toAgentTab(tab))?.value ?? 'chat';
}

/**
 * Asks before unsaved changes are lost, on every way out of the page
 * (CLEAN-228, research R6):
 *
 * | Way out                                   | Mechanism                        |
 * |-------------------------------------------|----------------------------------|
 * | Another page                              | `onBeforeRouteLeave`             |
 * | Another agent, or `?tab=` by Back / link  | `onBeforeRouteUpdate`            |
 * | Another section or the Chat tab           | `setTab` awaits `confirmLeave`   |
 * | Closing or reloading the browser tab      | `beforeunload` (browser's prompt)|
 *
 * A change of hash or of any other query parameter on the same screen loses
 * nothing and is not asked about. One answer covers one way out: the route
 * guard does not ask again about the switch `setTab` already asked about.
 *
 * Call it in the setup of the component that owns the edits; it registers and
 * unregisters itself with that component.
 */
export function useUnsavedGuard(
  isDirty: MaybeRefOrGetter<boolean>,
  options: IUnsavedGuardOptions = {},
): IUnsavedGuard {
  const confirmStore = useConfirmStore();
  const router = useRouter();

  // The operator said "Discard" and the navigation it allowed has not landed
  // yet: the route guards below let that one through without a second prompt.
  let approved = false;
  let asking: Promise<boolean> | null = null;

  function question(): string {
    const count = options.count === undefined ? null : toValue(options.count);
    if (count === null || count <= 0) return 'You have unsaved changes on this agent.';
    return count === 1
      ? 'You have 1 unsaved change on this agent.'
      : `You have ${count} unsaved changes on this agent.`;
  }

  function confirmLeave(): Promise<boolean> {
    if (approved || !toValue(isDirty)) return Promise.resolve(true);
    // Two ways out at once (a click and a route change) share one dialog.
    if (asking) return asking;
    asking = confirmStore
      .ask({
        title: 'Discard unsaved changes?',
        description: question(),
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        variant: 'destructive',
      })
      .then((accepted) => {
        asking = null;
        if (accepted) {
          approved = true;
          options.onDiscard?.();
        }
        return accepted;
      });
    return asking;
  }

  // The approval is for one navigation; whatever happened to it, it is spent.
  const stopAfterEach = router.afterEach(() => {
    approved = false;
  });
  // … and it never outlives the edits it was given for.
  watch(
    () => toValue(isDirty),
    (dirty) => {
      if (dirty) approved = false;
    },
  );

  onBeforeRouteLeave(() => confirmLeave());

  onBeforeRouteUpdate((to, from) => {
    if (to.path === from.path && screenOf(to.query.tab) === screenOf(from.query.tab)) {
      return true;
    }
    return confirmLeave();
  });

  useEventListener(
    () => (typeof window === 'undefined' ? null : window),
    'beforeunload',
    (e: BeforeUnloadEvent) => {
      if (!toValue(isDirty)) return;
      e.preventDefault();
      e.returnValue = '';
    },
  );

  let unregister: (() => void) | null = null;
  onMounted(() => {
    unregister = registerTabLeaveGuard(confirmLeave);
  });
  onBeforeUnmount(() => {
    unregister?.();
    unregister = null;
    stopAfterEach();
  });

  return { confirmLeave };
}
