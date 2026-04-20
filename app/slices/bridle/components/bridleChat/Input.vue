<template>
  <form
    class="flex items-end gap-2 border-t p-3 bg-background"
    @submit.prevent="submit"
  >
    <textarea
      v-model="draft"
      :placeholder="t('chat.placeholder')"
      rows="1"
      class="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
      :disabled="disabled"
      @keydown.enter.exact.prevent="submit"
    />
    <button
      type="submit"
      class="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      :disabled="disabled || !draft.trim()"
    >
      {{ disabled ? t('chat.sending') : t('chat.send') }}
    </button>
  </form>
</template>

<script setup lang="ts">
const props = defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ send: [text: string] }>();
const { t } = useI18n();

const draft = ref('');

function submit() {
  const text = draft.value.trim();
  if (!text || props.disabled) return;
  emit('send', text);
  draft.value = '';
}
</script>
