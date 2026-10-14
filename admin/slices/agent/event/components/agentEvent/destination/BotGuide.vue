<script setup lang="ts">
/**
 * The four steps the owner takes in Slack before the bot can post: the ones
 * actually walked on 2026-10-14. Shown while the bot kind is selected.
 */
const STEPS: readonly { title: string; detail: string }[] = [
  {
    title: 'Give the app the two permissions',
    detail:
      'api.slack.com/apps → your app → OAuth & Permissions → Bot Token Scopes: add chat:write and reactions:write.',
  },
  {
    title: 'Reinstall and copy the token',
    detail:
      'Reinstall to Workspace, then copy the Bot User OAuth Token — it starts with xoxb-. A user token (xoxp-) is refused.',
  },
  {
    title: 'Invite the bot to the channel',
    detail:
      'In the alerts channel: /invite @<the app>. A reinstall with new scopes needs this again.',
  },
  {
    title: 'Find the channel id',
    detail:
      'Open the channel → its name in the header → About → Channel ID (C0…). The id, not the name.',
  },
];
</script>

<template>
  <ol class="grid gap-2 text-xs text-muted-foreground">
    <li v-for="(step, i) in STEPS" :key="step.title" class="flex gap-2">
      <span class="font-medium tabular-nums text-foreground">{{ i + 1 }}.</span>
      <span>
        <span class="font-medium text-foreground">{{ step.title }}.</span>
        {{ step.detail }}
      </span>
    </li>
    <li class="pl-5">
      <a class="underline" href="https://api.slack.com/apps" target="_blank" rel="noopener"
        >Your Slack apps</a
      >
    </li>
  </ol>
</template>
