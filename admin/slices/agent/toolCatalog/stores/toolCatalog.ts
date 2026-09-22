import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { ToolCatalogService } from '#toolCatalog/domain';
import type { IAgentToolCatalog } from '#toolCatalog/domain';

export type {
  IAgentToolCatalog,
  IAgentToolEntry,
  IAgentToolGroup,
} from '#toolCatalog/domain';

const getService = createServiceGetter<ToolCatalogService>('$toolCatalogService');

export interface IToolCatalogUiState {
  query: string;
  /**
   * Which accordions the person opened. `null` means they never touched
   * them and the sheet may pick a default; `[]` means they closed every one
   * — the two must stay distinct or the first group reopens on every collapse.
   */
  expanded: string[] | null;
}

const EMPTY_UI: IToolCatalogUiState = { query: '', expanded: null };

/**
 * One catalogue per agent (CLEAN-109), the entity the Tools panel renders.
 * Keyed by agent id because the Rancher page and an agent's Chat tab can be
 * open at once; sharing one record would show one agent the other's tools.
 * The sheet's own state (search text, which accordions are open) lives here
 * too, per agent, so reopening the sheet restores it within the session.
 */
export const useToolCatalogStore = defineStore('toolCatalog', () => {
  const catalogs = ref<Record<string, IAgentToolCatalog>>({});
  const ui = ref<Record<string, IToolCatalogUiState>>({});

  // Which agent's sheet is open. The button lives in the page header, the
  // sheet next to the composer it writes into; this is the one fact both
  // read, so neither has to know about the other.
  const sheetOpenFor = ref<string | null>(null);

  function openSheet(agentId: string): void {
    sheetOpenFor.value = agentId;
  }

  function closeSheet(): void {
    sheetOpenFor.value = null;
  }

  function byAgent(agentId: string): IAgentToolCatalog | undefined {
    return catalogs.value[agentId];
  }

  function upsert(catalog: IAgentToolCatalog): IAgentToolCatalog {
    catalogs.value = { ...catalogs.value, [catalog.agentId]: catalog };
    return catalogs.value[catalog.agentId];
  }

  /** Fetches upsert; the caller renders `byAgent`, never the return value. */
  async function fetchByAgent(agentId: string): Promise<IAgentToolCatalog> {
    const catalog = await getService().forAgent(agentId);
    return upsert(catalog);
  }

  function uiOf(agentId: string): IToolCatalogUiState {
    return ui.value[agentId] ?? EMPTY_UI;
  }

  function setQuery(agentId: string, query: string): void {
    ui.value = { ...ui.value, [agentId]: { ...uiOf(agentId), query } };
  }

  function setExpanded(agentId: string, expanded: string[]): void {
    ui.value = { ...ui.value, [agentId]: { ...uiOf(agentId), expanded } };
  }

  function toggleGroup(agentId: string, key: string): void {
    const current = uiOf(agentId).expanded ?? [];
    setExpanded(
      agentId,
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  }

  return {
    catalogs,
    ui,
    sheetOpenFor,
    openSheet,
    closeSheet,
    byAgent,
    upsert,
    fetchByAgent,
    uiOf,
    setQuery,
    setExpanded,
    toggleGroup,
  };
});
