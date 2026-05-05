<script setup lang="ts">
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '#theme/components/ui/sidebar';
import { Separator } from '#theme/components/ui/separator';
import { Sonner } from '#theme/components/ui/sonner';

const route = useRoute();
const confirmStore = useConfirmStore();

const pageTitle = computed(() => {
  const name = route.name?.toString() ?? '';
  if (!name) return 'Admin';
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
});
</script>

<template>
  <SidebarProvider>
    <LayoutSidebar />
    <SidebarInset>
      <header
        class="flex h-14 shrink-0 items-center gap-2 border-b px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
      >
        <SidebarTrigger class="-ml-1" />
        <Separator orientation="vertical" class="mx-2 h-4" />
        <h1 class="text-sm font-medium">{{ pageTitle }}</h1>
        <div class="ml-auto flex items-center">
          <AgentStatusIndicator />
        </div>
      </header>
      <div class="flex flex-1 flex-col gap-4 p-6 min-w-0 overflow-x-auto">
        <slot />
      </div>
    </SidebarInset>

    <ConfirmDialog
      v-model:open="confirmStore.open"
      :title="confirmStore.current?.title ?? 'Are you sure?'"
      :description="confirmStore.current?.description ?? ''"
      :confirm-label="confirmStore.current?.confirmLabel ?? 'OK'"
      :cancel-label="confirmStore.current?.cancelLabel ?? 'Cancel'"
      :variant="confirmStore.current?.variant ?? 'default'"
      @confirm="confirmStore.accept()"
    />

    <Sonner />
  </SidebarProvider>
</template>
