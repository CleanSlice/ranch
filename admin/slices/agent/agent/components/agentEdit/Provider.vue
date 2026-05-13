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
  IconTrash,
} from '@tabler/icons-vue';

const props = defineProps<{ id: string }>();

const agentStore = useAgentStore();
const templateStore = useTemplateStore();
const llmStore = useLlmStore();
const knowledgeStore = useKnowledgeStore();
const config = useRuntimeConfig();
const apiUrl =
  (config.public as { apiUrl?: string }).apiUrl ??
  (typeof process !== 'undefined' ? process.env.API_URL : undefined) ??
  'http://localhost:3333';

const [
  { data: agent, pending: pendingAgent, refresh: refreshAgent },
  { data: templates, pending: pendingTemplates },
  { pending: pendingLlms },
  { data: knowledges, pending: pendingKnowledges },
  { pending: pendingKnowledgeStatus },
] = await Promise.all([
  useAsyncData(`admin-agent-${props.id}-edit`, () =>
    agentStore.fetchById(props.id),
  ),
  useAsyncData('agent-edit-templates', () => templateStore.fetchAll()),
  useAsyncData('agent-edit-llms', () => llmStore.fetchAll()),
  useAsyncData(`agent-edit-knowledges-${props.id}`, () =>
    knowledgeStore.fetchAll(),
  ),
  useAsyncData(`agent-edit-knowledge-status-${props.id}`, () =>
    knowledgeStore.fetchStatus(),
  ),
]);
const pending = computed(
  () =>
    pendingAgent.value ||
    pendingTemplates.value ||
    pendingLlms.value ||
    pendingKnowledges.value ||
    pendingKnowledgeStatus.value,
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
      allowedOrigins: values.allowedOrigins,
      knowledgeIds: values.knowledgeIds ?? [],
    };
    await agentStore.update(props.id, update);
    agentStore.markPendingRestart(props.id);
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

// ─── Delete ────────────────────────────────────────────────────────────────
const removing = ref(false);
const removeError = ref<string | null>(null);
const confirmRemoveOpen = ref(false);

async function onRemove() {
  if (!agent.value || removing.value) return;
  removing.value = true;
  removeError.value = null;
  try {
    await agentStore.remove(agent.value.id);
    await navigateTo('/agents');
  } catch (err) {
    removeError.value = (err as Error).message || 'Delete failed';
  } finally {
    removing.value = false;
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
        :knowledges="knowledges ?? []"
        :knowledge-service-enabled="knowledgeStore.enabled"
        :initial-values="{
          name: agent.name,
          templateId: agent.templateId,
          llmCredentialId: agent.llmCredentialId,
          resources: agent.resources,
          isPublic: agent.isPublic,
          allowedOrigins: agent.allowedOrigins,
          knowledgeIds: agent.knowledgeIds,
        }"
        :submitting="submitting"
        submit-label="Save changes"
        disable-template
        @submit="onSubmit"
        @cancel="onCancel"
      />

      <AgentVisibilityProvider
        :agent-id="agent.id"
        :api-url="apiUrl"
        :is-public="agent.isPublic"
        :allowed-origins="agent.allowedOrigins"
        @saved="(updated) => (agent = updated)"
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

      <Card class="border-destructive/40">
        <CardHeader>
          <CardTitle class="flex items-center gap-2 text-base text-destructive">
            <IconTrash class="size-4" />
            Danger zone
          </CardTitle>
          <CardDescription>
            Deleting this agent is permanent and cannot be undone. This will:
          </CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          <ul class="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>stop the running pod and cancel its Argo workflow</li>
            <li>
              remove all S3-stored agent data under
              <code class="font-mono text-xs">agents/{{ agent.id }}/</code>
              (files, secrets, usage)
            </li>
            <li>delete agent-scoped paddock scenarios and evaluation history</li>
            <li>revoke any service tokens minted for this agent</li>
          </ul>
          <div class="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <div class="text-sm">
              <p class="font-medium">Delete agent “{{ agent.name }}”</p>
              <p class="text-xs text-muted-foreground">
                This action is irreversible.
              </p>
            </div>
            <Button
              variant="destructive"
              :disabled="removing"
              @click="confirmRemoveOpen = true"
            >
              <IconLoader2 v-if="removing" class="size-4 animate-spin" />
              <IconTrash v-else class="size-4" />
              {{ removing ? 'Deleting…' : 'Delete agent' }}
            </Button>
          </div>
          <p v-if="removeError" class="text-xs text-destructive">{{ removeError }}</p>
        </CardContent>
      </Card>

      <ConfirmDialog
        v-model:open="confirmRemoveOpen"
        title="Delete agent"
        :description="`Permanently delete agent “${agent.name}”? Pod, S3 data, scenarios and evaluations will be removed. This cannot be undone.`"
        confirm-label="Delete agent"
        :busy="removing"
        @confirm="onRemove"
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
