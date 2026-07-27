<script setup lang="ts">
import type { IPaddockScenario } from '#paddock/stores/paddockScenario';

defineProps<{ agentId: string }>();

const scenarioListRef = ref<{ refresh: () => Promise<void> } | null>(null);
const evalListRef = ref<{ refresh: () => Promise<void> } | null>(null);
const formOpen = ref(false);
const editing = ref<IPaddockScenario | null>(null);

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
  <div class="flex flex-col gap-6">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">Paddock</h2>
        <p class="text-sm text-muted-foreground">
          Run evaluations and manage agent-specific scenario overrides.
        </p>
      </div>
      <PaddockEvaluationRunProvider :agent-id="agentId" @started="onEvalStarted" />
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
