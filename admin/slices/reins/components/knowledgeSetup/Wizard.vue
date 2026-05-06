<script setup lang="ts">
import type { IKnowledgeSetupStatus } from '#reins/stores/knowledge';
import { Button } from '#theme/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import { IconCheck, IconCircle, IconCopy } from '@tabler/icons-vue';

interface IStep {
  id: string;
  title: string;
  description: string;
  done: boolean;
  cta?: { label: string; to: string };
}

const props = defineProps<{
  setup: IKnowledgeSetupStatus;
  enabled: boolean;
}>();

const configStepDone = computed(
  () =>
    props.enabled &&
    props.setup.hasUrl &&
    props.setup.hasBucket &&
    props.setup.hasCredentialsSelected,
);

const steps = computed<IStep[]>(() => [
  {
    id: 'embedding-credential',
    title: 'Create an embedding LLM credential',
    description:
      'Knowledge needs a model that turns source chunks into vectors (e.g. OpenAI text-embedding-3-small).',
    done: props.setup.hasEmbeddingCredential,
    cta: { label: 'Create embedding credential', to: '/llms/create?capability=embedding' },
  },
  {
    id: 'chat-credential',
    title: 'Create a chat LLM credential',
    description:
      'LightRAG uses a chat model to answer queries (e.g. OpenAI gpt-4o-mini or Anthropic Claude).',
    done: props.setup.hasChatCredential,
    cta: { label: 'Create chat credential', to: '/llms/create?capability=chat' },
  },
  {
    id: 'service-config',
    title: 'Configure the Knowledge service',
    description:
      'Set the LightRAG URL, S3 bucket, pick chat and embedding credentials, then turn the service on.',
    done: configStepDone.value,
    cta: { label: 'Open settings', to: '/settings/knowledge' },
  },
  {
    id: 'restart-lightrag',
    title: 'Restart LightRAG',
    description:
      "Apply the new env vars by restarting the container so LightRAG picks up the OpenAI key and models. Until that, queries will use the previous binding.",
    done: props.setup.isHealthy,
  },
]);

const allDone = computed(() => steps.value.every((s) => s.done));

const firstPendingId = computed<string | null>(() => {
  const pending = steps.value.find((s) => !s.done);
  return pending !== undefined ? pending.id : null;
});

const localCommand = 'make dev';
const k8sCommand = 'kubectl rollout restart deploy/lightrag -n platform';

const copiedKey = ref<string | null>(null);
async function copy(value: string, key: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  copiedKey.value = key;
  setTimeout(() => {
    if (copiedKey.value === key) copiedKey.value = null;
  }, 1500);
}

</script>

<template>
  <Card v-if="!allDone">
    <CardHeader>
      <CardTitle>Set up Knowledge</CardTitle>
      <CardDescription>
        Knowledge is not ready yet. Walk through the steps below to bring the
        service online.
      </CardDescription>
    </CardHeader>
    <CardContent class="grid gap-3">
      <ol class="grid gap-3">
        <li
          v-for="step in steps"
          :key="step.id"
          :aria-current="step.id === firstPendingId ? 'step' : undefined"
          class="flex items-start gap-3 rounded-md border p-3"
          :class="step.done ? 'bg-muted/30' : 'bg-background'"
        >
          <span
            class="mt-0.5 inline-flex size-5 items-center justify-center rounded-full"
            :class="
              step.done
                ? 'bg-emerald-500/15 text-emerald-600'
                : 'bg-muted text-muted-foreground'
            "
          >
            <IconCheck v-if="step.done" class="size-3.5" />
            <IconCircle v-else class="size-3.5" />
          </span>
          <div class="flex-1 grid gap-2">
            <div class="flex items-baseline justify-between gap-2">
              <h3 class="text-sm font-medium">{{ step.title }}</h3>
              <span
                v-if="step.done"
                class="text-xs font-medium text-emerald-600"
              >
                Done
              </span>
            </div>
            <p class="text-xs text-muted-foreground">{{ step.description }}</p>

            <template v-if="step.id === 'restart-lightrag' && !step.done">
              <div class="grid gap-2">
                <p class="text-xs font-medium text-muted-foreground">Local</p>
                <div class="flex items-center gap-2">
                  <code class="rounded bg-muted px-2 py-1 text-xs">
                    {{ localCommand }}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    @click="copy(localCommand, 'local')"
                  >
                    <IconCopy class="size-3.5 mr-1" />
                    {{ copiedKey === 'local' ? 'Copied' : 'Copy' }}
                  </Button>
                </div>
                <p class="text-xs font-medium text-muted-foreground">Kubernetes</p>
                <div class="flex items-center gap-2">
                  <code class="rounded bg-muted px-2 py-1 text-xs">
                    {{ k8sCommand }}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    @click="copy(k8sCommand, 'k8s')"
                  >
                    <IconCopy class="size-3.5 mr-1" />
                    {{ copiedKey === 'k8s' ? 'Copied' : 'Copy' }}
                  </Button>
                </div>
              </div>
            </template>

            <div v-else-if="step.cta && !step.done">
              <NuxtLink :to="step.cta.to">
                <Button type="button" size="sm" variant="default">
                  {{ step.cta.label }}
                </Button>
              </NuxtLink>
            </div>
          </div>
        </li>
      </ol>
    </CardContent>
  </Card>
  <div
    v-else
    class="inline-flex items-center gap-2 rounded-md border bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700"
  >
    <IconCheck class="size-3.5" />
    Knowledge is ready
  </div>
</template>
