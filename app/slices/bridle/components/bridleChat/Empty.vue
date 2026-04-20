<template>
  <div
    class="flex flex-col items-center justify-center h-full text-center text-muted-foreground px-6"
  >
    <div class="text-5xl mb-4">💬</div>
    <h2 class="text-lg font-semibold mb-1">{{ t('chat.empty_title') }}</h2>
    <p class="text-sm max-w-sm">{{ t('chat.empty_hint') }}</p>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n();
</script>
