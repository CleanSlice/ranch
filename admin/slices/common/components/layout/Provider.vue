<script setup lang="ts">
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '#theme/components/ui/sidebar';
import { Separator } from '#theme/components/ui/separator';

const route = useRoute();

const pageTitle = computed(() => {
  const name = route.name?.toString() ?? '';
  if (!name) return 'Admin';
  return name.charAt(0).toUpperCase() + name.slice(1);
});
</script>

<template>
  <SidebarProvider>
    <LayoutSidebar />
    <SidebarInset>
      <header class="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger class="-ml-1" />
        <Separator orientation="vertical" class="mx-2 h-4" />
        <h1 class="text-sm font-medium">{{ pageTitle }}</h1>
      </header>
      <main class="flex-1 p-6">
        <slot />
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
