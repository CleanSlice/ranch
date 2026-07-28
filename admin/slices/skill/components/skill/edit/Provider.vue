<script setup lang="ts">
import type { ISkillInput, ISkillDependentAgent } from '#skill/stores/skill';
import { AgentsService } from '#api/data';
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import { Button } from '#theme/components/ui/button';
import {
  IconArrowLeft,
  IconExternalLink,
  IconLoader2,
  IconCheck,
  IconX,
} from '@tabler/icons-vue';

const props = defineProps<{ id: string }>();

const skillStore = useSkillStore();
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

type RedeployStatus = 'pending' | 'running' | 'done' | 'failed';
interface RedeployRow {
  agent: ISkillDependentAgent;
  status: RedeployStatus;
  error?: string;
}

const modalOpen = ref(false);
const dependentAgents = ref<ISkillDependentAgent[]>([]);
const redeployRows = ref<RedeployRow[]>([]);
const redeploying = ref(false);

const { data: skill, pending } = await useAsyncData(
  `admin-skill-${props.id}-edit`,
  () => skillStore.fetchById(props.id),
);

async function onSubmit(values: ISkillInput) {
  submitting.value = true;
  errorMessage.value = null;
  try {
    await skillStore.update(props.id, values);
    dependentAgents.value = await skillStore.fetchDependentAgents(props.id);
    redeployRows.value = [];
    modalOpen.value = true;
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    submitting.value = false;
  }
}

function onCancel() {
  navigateTo('/skills');
}

const progress = computed(() => {
  const total = redeployRows.value.length;
  const settled = redeployRows.value.filter(
    (r) => r.status === 'done' || r.status === 'failed',
  ).length;
  return { total, settled };
});

async function startRedeploy() {
  if (redeploying.value || dependentAgents.value.length === 0) return;
  redeploying.value = true;
  redeployRows.value = dependentAgents.value.map((agent) => ({
    agent,
    status: 'pending',
  }));

  // Sequential: each restartAgent cancels the workflow and resubmits. Going
  // one-at-a-time keeps the UI honest (per-agent ✓ / ✗) and avoids slamming
  // the cluster scheduler with N parallel pod evictions.
  for (const row of redeployRows.value) {
    row.status = 'running';
    try {
      await AgentsService.agentControllerRestart({ path: { id: row.agent.id } });
      row.status = 'done';
    } catch (err) {
      row.status = 'failed';
      row.error = (err as Error).message;
    }
  }

  redeploying.value = false;
}

function closeModal() {
  // Block dismissing mid-redeploy — otherwise the loop keeps running headless
  // and the operator loses the progress view.
  if (redeploying.value) return;
  modalOpen.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      to="/skills"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <IconArrowLeft class="size-4" /> Back to skills
    </NuxtLink>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <template v-else-if="skill">
      <div>
        <h1 class="text-2xl font-semibold">Edit skill</h1>
        <p class="text-sm text-muted-foreground">
          <code>{{ skill.name }}</code> · {{ skill.title }}
        </p>
      </div>

      <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

      <SkillForm
        :initial-values="{
          name: skill.name,
          title: skill.title,
          body: skill.body,
          description: skill.description ?? undefined,
        }"
        :submitting="submitting"
        submit-label="Save changes"
        lock-name
        @submit="onSubmit"
        @cancel="onCancel"
      />

      <Card v-if="skill.files?.length" class="w-full min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle>Bundled files ({{ skill.files.length }})</CardTitle>
          <CardDescription>
            Sibling files imported from
            <a
              v-if="skill.source"
              :href="skill.source"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-1 underline"
            >
              source <IconExternalLink class="size-3.5" />
            </a>
            <span v-else>the original folder</span>.
            Mounted alongside <code>SKILL.md</code> at runtime.
          </CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-3 min-w-0">
          <details
            v-for="file in skill.files"
            :key="file.path"
            class="rounded-md border bg-muted/20"
          >
            <summary class="flex cursor-pointer items-center justify-between gap-2 p-2 text-xs font-mono">
              <span class="break-all">{{ file.path }}</span>
              <span class="shrink-0 text-muted-foreground">
                {{ file.content.length }} B
              </span>
            </summary>
            <pre
              class="max-h-[400px] overflow-auto whitespace-pre-wrap break-words border-t bg-background p-2 text-[11px] leading-relaxed"
            >{{ file.content }}</pre>
          </details>
        </CardContent>
      </Card>
    </template>

    <div
      v-else
      class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      Skill not found.
    </div>

    <DialogRoot :open="modalOpen" @update:open="(v) => (v ? (modalOpen = true) : closeModal())">
      <DialogPortal>
        <DialogOverlay
          class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80"
        />
        <DialogContent
          class="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-xl -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg duration-200"
        >
          <div class="flex flex-col gap-1">
            <DialogTitle class="text-foreground text-lg font-semibold">
              Saved
            </DialogTitle>
            <DialogDescription class="text-muted-foreground text-sm">
              <template v-if="dependentAgents.length === 0">
                No agents currently use this skill — nothing to redeploy.
              </template>
              <template v-else-if="redeployRows.length === 0">
                {{ dependentAgents.length }} agent{{ dependentAgents.length === 1 ? '' : 's' }}
                use this skill via templates. They keep running the old version
                until restarted.
              </template>
              <template v-else-if="redeploying">
                Redeploying {{ progress.settled }} / {{ progress.total }}…
              </template>
              <template v-else>
                Redeploy finished — {{ progress.settled }} / {{ progress.total }} processed.
              </template>
            </DialogDescription>
          </div>

          <ul
            v-if="redeployRows.length > 0"
            class="max-h-72 overflow-y-auto rounded-md border bg-muted/20 p-3"
          >
            <li
              v-for="row in redeployRows"
              :key="row.agent.id"
              class="flex items-center gap-2 py-1 text-sm"
            >
              <IconLoader2 v-if="row.status === 'running'" class="size-4 shrink-0 animate-spin text-primary" />
              <IconCheck v-else-if="row.status === 'done'" class="size-4 shrink-0 text-emerald-600" />
              <IconX v-else-if="row.status === 'failed'" class="size-4 shrink-0 text-destructive" />
              <span v-else class="inline-block size-4 shrink-0 rounded-full border border-muted-foreground/30" />
              <span class="truncate font-medium">{{ row.agent.name }}</span>
              <span class="shrink-0 text-xs text-muted-foreground">({{ row.agent.templateName }})</span>
              <span v-if="row.error" class="ml-auto truncate text-xs text-destructive">
                {{ row.error }}
              </span>
            </li>
          </ul>

          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              v-if="!redeploying"
              variant="outline"
              @click="navigateTo('/skills')"
            >
              Back to skills
            </Button>
            <Button
              v-if="dependentAgents.length > 0 && redeployRows.length === 0"
              @click="startRedeploy"
            >
              Redeploy {{ dependentAgents.length }} agent{{ dependentAgents.length === 1 ? '' : 's' }}
            </Button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>
