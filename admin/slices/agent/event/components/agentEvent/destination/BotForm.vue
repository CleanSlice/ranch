<script setup lang="ts">
/**
 * The bot kind's two fields. The token is a secret the API takes and never
 * hands back: a password field, cleared the moment it is sent. The channel
 * id is plain.
 */
const token = defineModel<string>('token', { required: true });
const channel = defineModel<string>('channel', { required: true });

defineProps<{
  /** The channel the saved destination already has, to prefill on replace. */
  currentChannel?: string | null;
}>();
</script>

<template>
  <div class="grid gap-3">
    <div class="grid gap-2">
      <Label for="notification-destination-token">Bot token</Label>
      <Input
        id="notification-destination-token"
        v-model="token"
        type="password"
        autocomplete="off"
        placeholder="xoxb-…"
      />
      <p class="text-xs text-muted-foreground">
        OAuth &amp; Permissions → Bot User OAuth Token. Stored and never shown again.
      </p>
    </div>
    <div class="grid gap-2">
      <Label for="notification-destination-channel">Channel id</Label>
      <Input
        id="notification-destination-channel"
        v-model="channel"
        autocomplete="off"
        :placeholder="currentChannel || 'C0…'"
      />
      <p class="text-xs text-muted-foreground">
        Channel → About → Channel ID. The id, not the name.
      </p>
    </div>
  </div>
</template>
