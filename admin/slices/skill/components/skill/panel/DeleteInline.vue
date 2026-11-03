<script setup lang="ts">
import type { ISkillTemplateRef } from '#skill/domain';

/**
 * Inline confirmation for Delete (CLEAN-205, US5): no modal, the sentence
 * names the slug and the templates that lose it, and focus lands on Keep
 * so a stray Enter cannot delete.
 */
const props = defineProps<{
  slug: string;
  templates: ISkillTemplateRef[];
  deleting: boolean;
}>();

const emit = defineEmits<{ keep: []; confirm: [] }>();

const keepButton = ref<{ $el?: HTMLElement } | HTMLElement | null>(null);

const sentence = computed(() => {
  const names = props.templates.map((t) => t.name);
  if (names.length === 0) return `Delete ${props.slug}? It is not in any template.`;
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Delete ${props.slug}? It is removed from ${list}.`;
});

onMounted(() => {
  const el = keepButton.value;
  const node = el && '$el' in el ? el.$el : el;
  (node as HTMLElement | undefined)?.focus?.();
});
</script>

<template>
  <div
    data-skill-delete-confirm
    role="group"
    aria-label="Confirm deletion"
    class="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
  >
    <p>{{ sentence }}</p>
    <div class="flex gap-2">
      <Button ref="keepButton" variant="outline" size="sm" data-action="keep" :disabled="deleting" @click="emit('keep')">
        Keep
      </Button>
      <Button variant="destructive" size="sm" data-action="delete" :disabled="deleting" @click="emit('confirm')">
        {{ deleting ? 'Deleting…' : 'Delete' }}
      </Button>
    </div>
  </div>
</template>
