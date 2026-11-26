import {
  panelLocation,
  parsePanelView,
  stepBack,
  type PanelView,
} from '#agent/utils/panelView';

/**
 * The agent panel's view, bound to the address of the agent page
 * (CLEAN-248). Every change is a push, so the browser's Back steps the same
 * way Escape does: conversation, list, chat.
 *
 * Called once, by the workspace: it owns the Escape listener.
 */
export function useAgentPanelView(agentId: () => string) {
  const route = useRoute();
  const router = useRouter();

  const view = computed<PanelView>(() => parsePanelView(route.query));

  function go(next: PanelView) {
    return router.push(panelLocation(agentId(), next));
  }

  const toChat = () => go({ kind: 'chat' });
  const toList = () => go({ kind: 'list' });
  const toConversation = (chatId: string) => go({ kind: 'conversation', chatId });
  function back() {
    const previous = stepBack(view.value);
    if (previous) void go(previous);
  }

  // Escape goes one step back, unless something smaller has the key first.
  // The New chat confirmation and the share panel listen on `document`, close
  // themselves and do not stop the event; by the time it bubbles on to
  // `window` their card is already out of the page, and the same key press
  // would step back as well. So this listens in the capture phase, where
  // whatever is going to take the key is still there to be seen, and leaves
  // the key to it by rule.
  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (view.value.kind === 'chat') return;
    // An open confirmation or panel closes itself.
    if (document.querySelector('[role="dialog"]')) return;
    // The Overview shown over the messages closes itself.
    if (document.querySelector('[data-overview-mode="overlay"]')) return;
    const target = event.target;
    if (target instanceof Element) {
      // The agents search clears itself with Escape.
      if (target.closest('[data-agent-search]')) return;
      // So does the history search, while it has text; empty, it lets go.
      if (
        target instanceof HTMLInputElement &&
        target.matches('[data-history-search]') &&
        target.value !== ''
      ) {
        return;
      }
    }
    back();
  }
  onMounted(() => window.addEventListener('keydown', onKeydown, true));
  onUnmounted(() => window.removeEventListener('keydown', onKeydown, true));

  return { view, toChat, toList, toConversation, back };
}
