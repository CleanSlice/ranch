import {
  DEFAULT_TAB,
  toAgentTab,
  type AgentTab,
} from '#agent/components/agent/workspace/sections';

/**
 * Something on screen that may object to the tab changing — today the
 * Overview page with unsaved edits (CLEAN-228, research R6). Switching tabs
 * only replaces the query, and the component that holds the edits is unmounted
 * by it, so this is asked BEFORE the query moves. Resolves `true` to let the
 * switch happen.
 *
 * Module-level on purpose: `setTab` is called from the header and from other
 * sections, none of which is an ancestor of the page that registered.
 */
export type TabLeaveGuard = () => Promise<boolean> | boolean;

const tabLeaveGuards = new Set<TabLeaveGuard>();

/** Register on mount; call the returned function on unmount. */
export function registerTabLeaveGuard(guard: TabLeaveGuard): () => void {
  tabLeaveGuards.add(guard);
  return () => {
    tabLeaveGuards.delete(guard);
  };
}

/** `true` when every registered guard lets the tab change. */
export async function mayLeaveTab(): Promise<boolean> {
  const guards = [...tabLeaveGuards];
  for (let i = 0; i < guards.length; i += 1) {
    if (!(await guards[i]!())) return false;
  }
  return true;
}

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

  function replaceTab(next: AgentTab): void {
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

  function setTab(next: AgentTab): void {
    if (next === tab.value) return;
    // Nothing registered: exactly the synchronous switch it always was.
    if (tabLeaveGuards.size === 0) {
      replaceTab(next);
      return;
    }
    void mayLeaveTab().then((allowed) => {
      // The operator may have moved on while the question was open.
      if (allowed && next !== tab.value) replaceTab(next);
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
