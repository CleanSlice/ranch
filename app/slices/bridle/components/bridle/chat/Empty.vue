<template>
  <div
    class="flex flex-col items-center justify-center h-full text-center text-muted-foreground px-6"
  >
    <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border bg-card text-primary">
      <Icon name="message-square" :size="24" />
    </div>
    <h2 class="text-lg font-semibold mb-1">{{ $t('chat.empty_title') }}</h2>
    <p class="text-sm max-w-sm">{{ $t('chat.empty_hint') }}</p>
  </div>
</template>

