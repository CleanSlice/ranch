import type { Ref } from 'vue';
import type { IAgentData } from '#agent/domain';
import type { SectionCounts } from '#agent/components/agent/settings/sections';

const EMPTY: SectionCounts = {
  knowledge: null,
  files: null,
  secrets: null,
  channels: null,
};

/**
 * How much each countable section holds, shown beside its name in the
 * settings navigator — the number is the reason to click, so it has to be
 * there before the click.
 *
 * Three rules this owes the UI:
 *
 * 1. **Nothing fetches until `enabled`** — an operator who keeps the panel
 *    collapsed should not pay for counts they never see. That is also why the
 *    knowledge count is assembled by hand here instead of riding
 *    `useAgentKnowledges`: that composable fires its `useAsyncData` calls the
 *    moment it is called, which would defeat the gate.
 * 2. **Each source fails independently.** One unreachable bucket must not
 *    blank the other three.
 * 3. **`null` is not `0`.** Unknown renders as nothing at all; zero renders
 *    as zero, because "no secrets attached" is real information.
 *
 * There is no aggregate endpoint and this deliberately does not add one — the
 * requests are the same ones the sections themselves make, and `useAsyncData`
 * / store caches are shared, so opening a section after reading its count
 * costs nothing extra.
 */
export function useAgentSectionCounts(
  agentId: string,
  agent: Ref<IAgentData | null | undefined>,
  enabled: Ref<boolean>,
) {
  const templateStore = useTemplateStore();
  const fileStore = useAgentFileStore();
  const secretStore = useAgentSecretStore();
  const channelStore = useAgentChannelStore();

  const files = ref<number | null>(null);
  const secrets = ref<number | null>(null);
  const channels = ref<number | null>(null);
  /** Knowledge bases the agent's template binds by default. Only fetched when
   *  the agent has no per-agent override to count instead. */
  const templateKnowledge = ref<number | null>(null);

  let started = false;

  async function load() {
    if (started || !enabled.value) return;
    started = true;

    await Promise.allSettled([
      fileStore
        .fetchList(agentId)
        .then((nodes) => {
          files.value = nodes.length;
        })
        .catch(() => {
          files.value = null;
        }),
      secretStore
        .fetchForAgent(agentId)
        .then((data) => {
          // The store swallows its own errors and returns null; that is
          // "unknown", not "none".
          secrets.value = data ? data.secrets.length : null;
        })
        .catch(() => {
          secrets.value = null;
        }),
      channelStore
        .fetchForAgent(agentId)
        .then((list) => {
          channels.value = list.length;
        })
        .catch(() => {
          channels.value = null;
        }),
      loadTemplateKnowledge(),
    ]);
  }

  /** Only the template branch of the knowledge count: a per-agent override is
   *  already on the record, so there is nothing to fetch for it. */
  async function loadTemplateKnowledge() {
    const templateId = agent.value?.templateId;
    if (!templateId || (agent.value?.knowledgeIds.length ?? 0) > 0) return;
    try {
      const template = await templateStore.fetchById(templateId);
      templateKnowledge.value = template?.defaultKnowledgeIds.length ?? null;
    } catch {
      templateKnowledge.value = null;
    }
  }

  watch(
    enabled,
    (on) => {
      if (on) void load();
    },
    { immediate: true },
  );

  // The agent record arrives after the panel may already have opened, so the
  // template lookup can only run once we know which template to look up.
  watch(
    () => agent.value?.templateId,
    () => {
      if (enabled.value && started) void loadTemplateKnowledge();
    },
  );

  const counts = computed<SectionCounts>(() => {
    if (!enabled.value) return EMPTY;
    const overrides = agent.value?.knowledgeIds.length ?? 0;
    return {
      // An override on the agent wins; otherwise the count is whatever the
      // template binds. Same precedence the Knowledge section itself uses.
      knowledge: overrides > 0 ? overrides : templateKnowledge.value,
      files: files.value,
      secrets: secrets.value,
      channels: channels.value,
    };
  });

  return { counts };
}
