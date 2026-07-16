<script setup lang="ts">
definePageMeta({ name: 'chats' });
</script>

<template>
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Chats</h1>
      <p class="text-sm text-muted-foreground">
        Conversation history across all channels, indexed from agent sessions.
      </p>
    </div>
    <ChatListProvider />
</template>
