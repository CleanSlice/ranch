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
  IconCheck,
  IconDownload,
  IconLoader2,
  IconShield,
  IconShieldOff,
  IconTrash,
} from '@tabler/icons-vue';
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui';

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
const fileStore = useAgentFileStore();

const removing = ref(false);
const removeError = ref<string | null>(null);
const confirmRemoveOpen = ref(false);
// Opt-in S3 wipe. Off by default so an accidental Delete doesn't nuke
// files the operator might still want — the dialog also offers a
// pre-download for that case.
const wipeS3 = ref(false);

const downloadingForDelete = ref(false);
const downloadForDeleteError = ref<string | null>(null);

async function onDownloadBeforeDelete() {
  if (!agent.value || downloadingForDelete.value) return;
  downloadingForDelete.value = true;
  downloadForDeleteError.value = null;
  try {
    await fileStore.downloadZip(agent.value.id);
  } catch (err) {
    downloadForDeleteError.value =
      (err as Error).message || 'Download failed';
  } finally {
    downloadingForDelete.value = false;
  }
}

watch(confirmRemoveOpen, (open) => {
  // Reset dialog state when it closes so the next open doesn't carry over
  // a stale wipe choice or stale download error.
  if (!open) {
    wipeS3.value = false;
    downloadForDeleteError.value = null;
  }
});

async function onRemove() {
  if (!agent.value || removing.value) return;
  removing.value = true;
  removeError.value = null;
  try {
    await agentStore.remove(agent.value.id, { wipeS3: wipeS3.value });
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
            <li>delete agent-scoped paddock scenarios and evaluation history</li>
            <li>revoke any service tokens minted for this agent</li>
            <li>
              optionally wipe S3 data under
              <code class="font-mono text-xs">agents/{{ agent.id }}/</code>
              (files, skills, secrets, usage) — opt-in in the confirm dialog
            </li>
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

      <AlertDialogRoot v-model:open="confirmRemoveOpen">
        <AlertDialogPortal>
          <AlertDialogOverlay
            class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80"
          />
          <AlertDialogContent
            class="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg duration-200"
          >
            <div class="flex flex-col gap-2 text-left">
              <AlertDialogTitle class="text-foreground text-lg font-semibold">
                Delete agent
              </AlertDialogTitle>
              <AlertDialogDescription class="text-muted-foreground text-sm">
                Permanently delete agent “{{ agent.name }}”? Pod, scenarios
                and evaluations will be removed. This cannot be undone.
              </AlertDialogDescription>
            </div>

            <div class="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 text-sm">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="font-medium">Download a backup first</p>
                  <p class="text-xs text-muted-foreground">
                    ZIP of every file under
                    <code class="font-mono text-xs">agents/{{ agent.id }}/</code>.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="downloadingForDelete"
                  @click="onDownloadBeforeDelete"
                >
                  <IconLoader2
                    v-if="downloadingForDelete"
                    class="size-4 animate-spin"
                  />
                  <IconDownload v-else class="size-4" />
                  {{ downloadingForDelete ? 'Downloading…' : 'Download' }}
                </Button>
              </div>
              <p v-if="downloadForDeleteError" class="text-xs text-destructive">
                {{ downloadForDeleteError }}
              </p>
            </div>

            <label
              class="flex cursor-pointer items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
            >
              <input
                v-model="wipeS3"
                type="checkbox"
                class="mt-0.5 size-4 accent-destructive"
              />
              <span class="flex flex-col gap-1">
                <span class="font-medium">
                  Also wipe S3 storage
                  <IconCheck
                    v-if="wipeS3"
                    class="inline size-3 align-text-bottom text-destructive"
                  />
                </span>
                <span class="text-xs text-muted-foreground">
                  Drops every object under
                  <code class="font-mono text-xs">agents/{{ agent.id }}/</code>.
                  Without this, S3 data is preserved.
                </span>
              </span>
            </label>

            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                :disabled="removing"
                @click="confirmRemoveOpen = false"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                :disabled="removing"
                @click="onRemove"
              >
                <IconLoader2 v-if="removing" class="size-4 animate-spin" />
                <IconTrash v-else class="size-4" />
                {{ removing
                  ? 'Deleting…'
                  : wipeS3
                    ? 'Delete agent + wipe S3'
                    : 'Delete agent' }}
              </Button>
            </div>
          </AlertDialogContent>
        </AlertDialogPortal>
      </AlertDialogRoot>
    </template>

    <div
      v-else
      class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      Agent not found.
    </div>
  </div>
</template>
