<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import type { IPaddockScenario } from '#paddock/stores/paddockScenario';

const route = useRoute();
const templateId = computed(() => route.params.id as string);

useHead({ title: () => `Paddock · ${templateId.value}` });

const formOpen = ref(false);
const editing = ref<IPaddockScenario | null>(null);
const listRef = ref<{ refresh: () => Promise<void> } | null>(null);

function onCreate() {
  editing.value = null;
  formOpen.value = true;
}

function onEdit(scenario: IPaddockScenario) {
  editing.value = scenario;
  formOpen.value = true;
}

async function onSaved() {
  await listRef.value?.refresh();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Template paddock</h1>
        <p class="text-sm text-muted-foreground">
          Default scenarios for agents created from this template.
        </p>
      </div>
      <Button variant="outline" as-child>
        <NuxtLink :to="`/templates/${templateId}`">Back to template</NuxtLink>
      </Button>
    </div>

    <PaddockScenarioListProvider
      ref="listRef"
      :template-id="templateId"
      @create="onCreate"
      @edit="onEdit"
    />

    <PaddockScenarioFormProvider
      v-model:open="formOpen"
      :template-id="templateId"
      :scenario="editing"
      @saved="onSaved"
    />
  </div>
</template>
