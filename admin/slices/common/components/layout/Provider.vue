<script setup lang="ts">
import { SidebarInset, SidebarProvider, SidebarTrigger } from '#theme/components/ui/sidebar';
import { Separator } from '#theme/components/ui/separator';
import { Sonner } from '#theme/components/ui/sonner';
import { PAGE_TITLE_TARGET_ID, usePageCrumbs } from '#common/composables/usePageCrumbs';
import { pageTitle } from '#common/utils/pageTitle';

// The top bar (CLEAN-135): sidebar toggle, the page's title, the Live
// indicator. It was dropped in CLEAN-131 and is back slimmer, because the
// toggle and Live are where people look for them. What changed for good is
// the title: a page with breadcrumbs shows them here (PageBreadcrumbs moves
// itself into the title slot and counts in), every other page shows the
// name of its sidebar section — never the raw route name.
const route = useRoute();
const menu = useMenuStore();
const confirmStore = useConfirmStore();

const crumbs = usePageCrumbs();
const title = computed(() => pageTitle(route.name?.toString(), menu.getSidebar));
</script>

<template>
  <SidebarProvider>
    <LayoutSidebar />
    <SidebarInset>
      <header class="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <SidebarTrigger class="-ml-1" />
        <Separator orientation="vertical" class="mx-1 h-4" />
        <div class="flex min-w-0 flex-1 items-center">
          <div :id="PAGE_TITLE_TARGET_ID" class="min-w-0" />
          <p v-if="!crumbs" class="truncate text-sm font-medium">{{ title }}</p>
        </div>
        <AgentStatusIndicator class="-mr-1" />
      </header>
      <!-- overflow-x-clip (not -auto): `-auto` coerces overflow-y to `auto`,
           turning this into a scroll container that breaks `position: sticky`
           for every page inside it. `clip` contains horizontal blow-out
           without that side effect. -->
      <div class="flex flex-1 flex-col gap-4 p-3 min-w-0 overflow-x-clip">
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
