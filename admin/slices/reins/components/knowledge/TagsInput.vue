<script setup lang="ts">
import { Input } from '#theme/components/ui/input';
import { Badge } from '#theme/components/ui/badge';

const props = defineProps<{
  modelValue: string[];
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const draft = ref('');

function add() {
  const v = draft.value.trim();
  if (!v) return;
  if (props.modelValue.includes(v)) {
    draft.value = '';
    return;
  }
  emit('update:modelValue', [...props.modelValue, v]);
  draft.value = '';
}

function remove(tag: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter((t) => t !== tag),
  );
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    add();
  } else if (e.key === 'Backspace' && !draft.value && props.modelValue.length) {
    remove(props.modelValue[props.modelValue.length - 1]);
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-if="modelValue.length" class="flex flex-wrap gap-1">
      <Badge
        v-for="tag in modelValue"
        :key="tag"
        variant="secondary"
        class="cursor-pointer"
        @click="remove(tag)"
      >
        {{ tag }}
        <span class="ml-1 text-muted-foreground">×</span>
      </Badge>
    </div>
    <Input
      v-model="draft"
      :placeholder="placeholder ?? 'Type and press Enter'"
      @keydown="onKeydown"
      @blur="add"
    />
  </div>
</template>
