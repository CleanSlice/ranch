<script setup lang="ts">
import { SidebarInset, SidebarProvider, SidebarTrigger } from '#theme/components/ui/sidebar';
import { Sonner } from '#theme/components/ui/sonner';

// No content header (CLEAN-131): the route-name title it carried duplicated
// every page's own heading and sat in the way of real breadcrumbs, and the
// collapse toggle and the Live indicator now live in the sidebar header. On
// a phone the sidebar is a sheet with nothing on screen to open it from, so
// a floating toggle stays there.
const confirmStore = useConfirmStore();
</script>

<template>
  <SidebarProvider>
    <LayoutSidebar />
    <SidebarInset>
      <SidebarTrigger
        class="fixed left-3 top-3 z-30 size-9 rounded-lg border bg-background/90 shadow-xs backdrop-blur md:hidden"
      />
      <!-- overflow-x-clip (not -auto): `-auto` coerces overflow-y to `auto`,
           turning this into a scroll container that breaks `position: sticky`
           for every page inside it. `clip` contains horizontal blow-out
           without that side effect. -->
      <div class="flex flex-1 flex-col gap-4 p-3 pt-14 min-w-0 overflow-x-clip md:pt-3">
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
