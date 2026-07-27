import type { Ref } from 'vue';
import type { IAgentData } from '#agent/domain';

/**
 * Knowledge bases effectively bound to an agent: the per-agent override when
 * set, otherwise the template defaults. Fetches the template and the
 * knowledge list itself (keys are shared, so concurrent consumers dedupe).
 */
export function useAgentKnowledges(
  agentId: string,
  agent: Ref<IAgentData | null | undefined>,
) {
  const templateStore = useTemplateStore();
  const knowledgeStore = useKnowledgeStore();

  const { data: template, pending: templatePending } = useAsyncData(
    `admin-agent-template-${agentId}`,
    async () => {
      const tplId = agent.value?.templateId;
      if (!tplId) return null;
      return templateStore.fetchById(tplId);
    },
    { lazy: true, watch: [agent] },
  );

  const { data: knowledges, pending: knowledgesPending } = useAsyncData(
    'admin-knowledges-all',
    () => knowledgeStore.fetchAll(),
    { lazy: true },
  );

  const effective = computed(() => {
    if (!agent.value || !template.value) {
      return { ids: [] as string[], source: 'none' as const };
    }
    if (agent.value.knowledgeIds.length > 0) {
      return { ids: agent.value.knowledgeIds, source: 'agent-override' as const };
    }
    return { ids: template.value.defaultKnowledgeIds, source: 'from-template' as const };
  });

  const resolved = computed(() => {
    const idSet = new Set(effective.value.ids);
    return (knowledges.value ?? []).filter((k) => idSet.has(k.id));
  });

  const pending = computed(
    () => (knowledgesPending.value || templatePending.value) && !knowledges.value,
  );

  return { template, effective, resolved, pending };
}
