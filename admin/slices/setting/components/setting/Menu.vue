<script setup lang="ts">
interface IMenuItem {
  title: string;
  description?: string;
  to: string;
}

const items: IMenuItem[] = [
  { title: 'Organization', description: 'Name shown across the admin UI.', to: '/settings/organization' },
  { title: 'Agent defaults', description: 'Default CPU and memory for agents.', to: '/settings/agents' },
  { title: 'GitHub', description: 'Personal Access Token for private images.', to: '/settings/github' },
  { title: 'Bridle', description: 'Chat hub URL agents connect to.', to: '/settings/bridle' },
  { title: 'Storage', description: 'S3 / MinIO persistence.', to: '/settings/storage' },
  { title: 'Secrets', description: 'Where agents store user secrets.', to: '/settings/secrets' },
];
</script>

<template>
  <nav class="flex flex-col gap-1">
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="group rounded-md border border-transparent px-3 py-2 text-sm transition-colors hover:bg-muted"
      active-class="border-border bg-muted"
    >
      <span class="block font-medium">{{ item.title }}</span>
      <span
        v-if="item.description"
        class="block text-xs text-muted-foreground"
      >
        {{ item.description }}
      </span>
    </NuxtLink>
  </nav>
</template>
