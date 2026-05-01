<script setup lang="ts">
interface IMenuItem {
  title: string;
  description?: string;
  to: string;
}

const items: IMenuItem[] = [
  { title: 'Search', description: 'Browse curated public agent-skill repos.', to: '/skills/import/search' },
  { title: 'Import by URL', description: 'Paste a GitHub folder or SKILL.md link.', to: '/skills/import/url' },
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
