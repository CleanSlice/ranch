import type { Ref } from 'vue';
import type { IAgentData } from '#agent/domain';
import type { SectionCounts } from '#agent/components/agent/workspace/sections';

/**
 * How much each countable tab holds, shown beside its name in the tab bar —
 * the number is the reason to click, so it has to be there before the click.
 *
 * Four rules this owes the UI:
 *
 * 1. **Each source fails independently.** One unreachable bucket must not
 *    blank the other three.
 * 2. **`null` is not `0`.** Unknown renders as nothing at all; zero renders
 *    as zero, because "no secrets attached" is real information.
 * 3. **The knowledge count is assembled by hand** rather than riding
 *    `useAgentKnowledges`, so that an agent whose knowledge is a per-agent
 *    override costs no template fetch at all.
 * 4. **Nothing is fetched until Settings is wanted.** `load()` is the host's
 *    to call — on hover of the Settings tab and on opening it, never at page
 *    load, where Chat is on screen and this navigator is not in the DOM at
 *    all (CLEAN-233). Calling it twice costs one fetch.
 *
 * There is no aggregate endpoint and this deliberately does not add one — the
 * requests are the same ones the sections themselves make, and `useAsyncData`
 * / store caches are shared, so opening a section after reading its count
 * costs nothing extra.
 */
export function useAgentSectionCounts(
  agentId: string,
  agent: Ref<IAgentData | null | undefined>,
  /** False for a viewer who may not manage the agent (CLEAN-232): the four
   *  sources are management routes and answer "Agent not found" to them, so
   *  nothing is asked and every count stays unknown. */
  enabled: Ref<boolean> = ref(true),
) {
  const templateStore = useTemplateStore();
  const fileStore = useAgentFileStore();
  const secretStore = useAgentSecretStore();
  const channelStore = useAgentChannelStore();
  const peerStore = usePeerStore();

  const files = ref<number | null>(null);
  const secrets = ref<number | null>(null);
  const channels = ref<number | null>(null);
  const peers = ref<number | null>(null);
  /** Knowledge bases the agent's template binds by default. Only fetched when
   *  the agent has no per-agent override to count instead. */
  const templateKnowledge = ref<number | null>(null);

  let started = false;
  /** load() was called, whether or not it could run yet. */
  let wanted = false;

  async function load() {
    wanted = true;
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
      peerStore
        .load(agentId)
        .then(() => {
          peers.value = peerStore.peers(agentId).length;
        })
        .catch(() => {
          peers.value = null;
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

  // Deliberately NOT on mount. The Chat tab is where an agent opens, and the
  // navigator these numbers sit in is not even rendered there — six requests
  // for figures nobody can see, three of them a second slow on production,
  // all of it racing the chat transcript for connections (CLEAN-233). The
  // host calls load() when Settings is opened, and on hover of the Settings
  // tab, so the numbers are still there before the click.

  // Whether the viewer manages the agent is only known when the agent record
  // has arrived, and a deep link into a section asks before that: the load
  // it asked for runs then (CLEAN-232).
  watch(enabled, (ok) => {
    if (ok && wanted) void load();
  });

  // The agent record arrives after the first paint, so the template lookup can
  // only run once we know which template to look up.
  watch(
    () => agent.value?.templateId,
    () => {
      if (started) void loadTemplateKnowledge();
    },
  );

  const counts = computed<SectionCounts>(() => {
    const overrides = agent.value?.knowledgeIds.length ?? 0;
    return {
      // An override on the agent wins; otherwise the count is whatever the
      // template binds. Same precedence the Knowledge section itself uses.
      knowledge: overrides > 0 ? overrides : templateKnowledge.value,
      files: files.value,
      secrets: secrets.value,
      channels: channels.value,
      a2a: peers.value,
    };
  });

  return { counts, load };
}
