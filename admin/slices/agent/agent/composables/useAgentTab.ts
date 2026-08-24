import {
  DEFAULT_TAB,
  toAgentTab,
  type AgentTab,
} from '#agent/components/agent/workspace/sections';

/**
 * Which tab the workspace is showing. It lives in `?tab=` and nowhere else:
 * addressable state belongs in the URL so it can be linked and shared, and
 * this is the same parameter the nine-tab column used, so every old deep link
 * still lands where it did.
 *
 * The default tab carries no parameter. `?tab=chat` therefore normalises
 * itself away — it stays valid for old links, it just does not linger in the
 * address bar afterwards.
 */
export function useAgentTab() {
  const route = useRoute();
  const router = useRouter();

  const tab = computed<AgentTab>(() => toAgentTab(route.query.tab));

  function setTab(next: AgentTab): void {
    if (next === tab.value) return;
    // `replace`, not `push`: switching tabs within one agent should not fill
    // the history stack. Switching *agents* is a push — that is real
    // navigation the operator expects Back to undo.
    void router.replace({
      query: {
        ...route.query,
        tab: next === DEFAULT_TAB ? undefined : next,
      },
    });
  }

  // Strip a stale or defaulted parameter so the URL says what the screen is
  // actually showing.
  onMounted(() => {
    const raw = route.query.tab;
    if (raw !== undefined && toAgentTab(raw) === DEFAULT_TAB) {
      void router.replace({ query: { ...route.query, tab: undefined } });
    }
  });

  return { tab, setTab };
}
