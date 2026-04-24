<script setup lang="ts">
import type { IKnowledge } from '#reins/stores/knowledge';
import { Button } from '#theme/components/ui/button';
import { Label } from '#theme/components/ui/label';

const store = useKnowledgeStore();
const current = inject<Ref<IKnowledge | null>>('knowledge-current');
const refresh = inject<() => Promise<void>>('knowledge-refresh');

const entityTypes = ref<string[]>([]);
const relationshipTypes = ref<string[]>([]);
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

watch(
  () => current?.value,
  (k) => {
    entityTypes.value = [...(k?.entityTypes ?? [])];
    relationshipTypes.value = [...(k?.relationshipTypes ?? [])];
  },
  { immediate: true },
);

async function save() {
  if (!current?.value) return;
  submitting.value = true;
  errorMessage.value = null;
  try {
    await store.update(current.value.id, {
      entityTypes: entityTypes.value,
      relationshipTypes: relationshipTypes.value,
    });
    if (refresh) await refresh();
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="flex max-w-2xl flex-col gap-6">
    <p class="text-sm text-muted-foreground">
      Entity and relationship types guide LightRAG's graph extraction.
      Examples: <code>person</code>, <code>product</code>, <code>concept</code>.
      Click a chip to remove it.
    </p>

    <div class="grid gap-2">
      <Label>Entity types</Label>
      <KnowledgeTagsInput
        v-model="entityTypes"
        placeholder="Add entity type…"
      />
    </div>

    <div class="grid gap-2">
      <Label>Relationship types</Label>
      <KnowledgeTagsInput
        v-model="relationshipTypes"
        placeholder="Add relationship type…"
      />
    </div>

    <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

    <div>
      <Button :disabled="submitting" @click="save">
        {{ submitting ? 'Saving…' : 'Save' }}
      </Button>
    </div>
  </div>
</template>
