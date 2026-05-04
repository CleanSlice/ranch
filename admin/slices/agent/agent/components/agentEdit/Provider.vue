<script setup lang="ts">
import type { ICreateAgentData, IUpdateAgentData } from '#agent/stores/agent';
import { Button } from '#theme/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import { Badge } from '#theme/components/ui/badge';
import {
  IconArrowLeft,
  IconLoader2,
  IconShield,
  IconShieldOff,
} from '@tabler/icons-vue';

const props = defineProps<{ id: string }>();

const agentStore = useAgentStore();
const templateStore = useTemplateStore();
const llmStore = useLlmStore();

const [
  { data: agent, pending: pendingAgent, refresh: refreshAgent },
  { data: templates, pending: pendingTemplates },
  { pending: pendingLlms },
] = await Promise.all([
  useAsyncData(`admin-agent-${props.id}-edit`, () =>
    agentStore.fetchById(props.id),
  ),
  useAsyncData('agent-edit-templates', () => templateStore.fetchAll()),
  useAsyncData('agent-edit-llms', () => llmStore.fetchAll()),
]);
const pending = computed(
  () => pendingAgent.value || pendingTemplates.value || pendingLlms.value,
);

const submitting = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(values: ICreateAgentData) {
  submitting.value = true;
  errorMessage.value = null;
  try {
    const update: IUpdateAgentData = {
      name: values.name,
      llmCredentialId: values.llmCredentialId ?? null,
      resources: values.resources,
      isPublic: values.isPublic,
    };
    await agentStore.update(props.id, update);
    await navigateTo(`/agents/${props.id}`);
  } catch (err: unknown) {
    const e = err as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    errorMessage.value =
      e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    submitting.value = false;
  }
}

function onCancel() {
  navigateTo(`/agents/${props.id}`);
}

// ─── Promote / demote ──────────────────────────────────────────────────────
const promoting = ref(false);
const promoteError = ref<string | null>(null);
const confirmPromoteOpen = ref(false);

async function onPromote() {
  if (!agent.value || promoting.value) return;
  promoting.value = true;
  promoteError.value = null;
  try {
    const updated = agent.value.isAdmin
      ? await agentStore.demoteAdmin(agent.value.id)
      : await agentStore.promoteAdmin(agent.value.id);
    agent.value = { ...updated, status: 'deploying' };
    await refreshAgent();
  } catch (err) {
    promoteError.value = (err as Error).message || 'Promote failed';
  } finally {
    promoting.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      :to="`/agents/${id}`"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <IconArrowLeft class="size-4" /> Back to agent
    </NuxtLink>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <template v-else-if="agent">
      <div>
        <h1 class="text-2xl font-semibold">Edit agent</h1>
        <p class="text-sm text-muted-foreground">{{ agent.name }}</p>
      </div>

      <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

      <AgentForm
        :templates="templates ?? []"
        :llms="llmStore.items"
        :initial-values="{
          name: agent.name,
          templateId: agent.templateId,
          llmCredentialId: agent.llmCredentialId,
          resources: agent.resources,
          isPublic: agent.isPublic,
        }"
        :submitting="submitting"
        submit-label="Save changes"
        disable-template
        @submit="onSubmit"
        @cancel="onCancel"
      />

      <Card>
        <CardHeader>
          <div class="flex items-center justify-between gap-3">
            <div>
              <CardTitle class="flex items-center gap-2 text-base">
                Ranch admin access
                <Badge v-if="agent.isAdmin" variant="default" class="gap-1">
                  <IconShield class="size-3" /> Admin
                </Badge>
              </CardTitle>
              <CardDescription>
                {{ agent.isAdmin
                  ? 'This agent has the ranch_* admin tools enabled and was deployed with RANCH_ADMIN=true. Demoting it drops those tools and redeploys.'
                  : 'Promote this agent to grant ranch_* admin tools and redeploy with RANCH_ADMIN=true. The flag is cleared from any other admin agent.' }}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              :disabled="promoting"
              @click="agent.isAdmin ? onPromote() : (confirmPromoteOpen = true)"
            >
              <IconLoader2 v-if="promoting" class="size-4 animate-spin" />
              <IconShieldOff v-else-if="agent.isAdmin" class="size-4" />
              <IconShield v-else class="size-4" />
              {{ agent.isAdmin ? 'Demote' : 'Promote to admin' }}
            </Button>
          </div>
        </CardHeader>
        <CardContent v-if="promoteError">
          <p class="text-xs text-destructive">{{ promoteError }}</p>
        </CardContent>
      </Card>

      <ConfirmDialog
        v-model:open="confirmPromoteOpen"
        title="Promote to Ranch admin"
        :description="`Grant ranch_* tools to “${agent.name}” and redeploy with RANCH_ADMIN=true. The flag is cleared from any other admin agent and that agent is also redeployed.`"
        confirm-label="Promote"
        :variant="'default'"
        @confirm="onPromote"
      />
    </template>

    <div
      v-else
      class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      Agent not found.
    </div>
  </div>
</template>
