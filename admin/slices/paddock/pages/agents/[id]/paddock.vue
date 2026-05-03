<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import type { IPaddockScenario } from '#paddock/stores/paddockScenario';

const route = useRoute();
const agentId = computed(() => route.params.id as string);

useHead({ title: () => `Paddock · ${agentId.value}` });

const formOpen = ref(false);
const editing = ref<IPaddockScenario | null>(null);
const scenarioListRef = ref<{ refresh: () => Promise<void> } | null>(null);
const evalListRef = ref<{ refresh: () => Promise<void> } | null>(null);

function onCreate() {
  editing.value = null;
  formOpen.value = true;
}

function onEdit(scenario: IPaddockScenario) {
  editing.value = scenario;
  formOpen.value = true;
}

async function onScenarioSaved() {
  await scenarioListRef.value?.refresh();
}

async function onEvalStarted() {
  await evalListRef.value?.refresh();
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Agent paddock</h1>
        <p class="text-sm text-muted-foreground">
          Run evaluations and manage agent-specific scenario overrides.
        </p>
      </div>
      <div class="flex gap-2">
        <PaddockEvaluationRunProvider :agent-id="agentId" @started="onEvalStarted" />
        <Button variant="outline" as-child>
          <NuxtLink :to="`/agents/${agentId}`">Back to agent</NuxtLink>
        </Button>
      </div>
    </div>

    <PaddockEvaluationListProvider ref="evalListRef" :agent-id="agentId" />

    <PaddockScenarioListProvider
      ref="scenarioListRef"
      :agent-id="agentId"
      @create="onCreate"
      @edit="onEdit"
    />

    <PaddockScenarioFormProvider
      v-model:open="formOpen"
      :agent-id="agentId"
      :scenario="editing"
      @saved="onScenarioSaved"
    />
  </div>
</template>
