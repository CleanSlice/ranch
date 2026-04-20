<template>
  <div class="flex" :class="isUser ? 'justify-end' : 'justify-start'">
    <div
      class="max-w-[75%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap break-words"
      :class="
        isUser
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-foreground'
      "
    >
      <div class="text-xs opacity-70 mb-1">
        {{ isUser ? t('chat.you') : t('chat.agent') }}
      </div>
      <div>{{ message.text }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BridleRoleTypes, type IBridleMessage } from '#bridle/stores/bridle';

const props = defineProps<{ message: IBridleMessage }>();
const { t } = useI18n();

const isUser = computed(() => props.message.role === BridleRoleTypes.User);
</script>
