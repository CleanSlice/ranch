import {
  toSettingsSection,
  type AgentSettingsSection,
} from '#agent/components/agent/settings/sections';

const PANEL_OPEN_KEY = 'agent:settingsPanelOpen';

// Absent means OPEN. Encoding the default as *absence* rather than writing
// '1' on first visit keeps a fresh browser, a cleared storage and a
// never-touched toggle behaving identically — and moves the default to one
// line if it ever changes.
function readStoredOpen(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(PANEL_OPEN_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    // Private-mode Safari throws on access. Fall back to the default.
    return true;
  }
}

function writeStoredOpen(open: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PANEL_OPEN_KEY, open ? '1' : '0');
  } catch {
    // Quota or private mode — the preference is a convenience, not state we
    // are allowed to fail over.
  }
}

/**
 * Two pieces of state that look like one and are deliberately not:
 *
 * - **which section the canvas shows** is addressable — it lives in `?tab=`,
 *   so it can be linked and shared;
 * - **whether the navigator is open** is a habit — it lives in localStorage,
 *   so it does not travel in someone else's link.
 *
 * A section being open forces the panel visible (FR-018: the operator must be
 * able to reach another section or the conversation), and that force does
 * *not* write the preference — following a `?tab=env` link must not
 * permanently reopen the panel for someone who keeps it collapsed.
 */
export function useSettingsPanel() {
  const route = useRoute();
  const router = useRouter();

  const section = computed<AgentSettingsSection | null>(() =>
    toSettingsSection(route.query.tab),
  );

  const storedOpen = ref(readStoredOpen());
  const open = computed(() => section.value !== null || storedOpen.value);

  function setSection(next: AgentSettingsSection | null): void {
    if (next === section.value) return;
    void router.replace({
      query: { ...route.query, tab: next ?? undefined },
    });
  }

  function setOpen(next: boolean): void {
    storedOpen.value = next;
    writeStoredOpen(next);
  }

  /**
   * Collapsing the navigator while a section is on the canvas would strand
   * the operator inside that section with no way back except the browser —
   * so closing also returns to the conversation.
   */
  function close(): void {
    if (section.value !== null) setSection(null);
    setOpen(false);
  }

  function toggle(): void {
    if (open.value) close();
    else setOpen(true);
  }

  // A stale `?tab=chat` (or anything unrecognised) resolves to "no section";
  // strip it so the URL says what the screen is actually showing.
  onMounted(() => {
    const raw = route.query.tab;
    if (raw !== undefined && toSettingsSection(raw) === null) {
      void router.replace({ query: { ...route.query, tab: undefined } });
    }
  });

  return { section, open, setSection, setOpen, close, toggle };
}
