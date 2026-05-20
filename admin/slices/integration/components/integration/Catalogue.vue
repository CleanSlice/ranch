<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import type {
  IIntegrationAccountData,
  IIntegrationCatalogueItem,
} from '#integration/stores/integration';

const props = defineProps<{
  items: IIntegrationCatalogueItem[];
  connected: IIntegrationAccountData[];
}>();

defineEmits<{
  (event: 'pick', item: IIntegrationCatalogueItem): void;
}>();

function connectedCount(service: string): number {
  return props.connected.filter((a) => a.service === service).length;
}
</script>

<template>
  <div
    v-if="items.length"
    class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
  >
    <button
      v-for="item in items"
      :key="item.service"
      type="button"
      class="group flex flex-col gap-2 rounded-lg border bg-card p-4 text-left transition hover:border-primary/40 hover:bg-accent/30"
      @click="$emit('pick', item)"
    >
      <div class="flex items-center gap-3">
        <div
          class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background"
        >
          <img
            :src="item.iconUrl"
            :alt="item.title"
            class="size-7"
            referrerpolicy="no-referrer"
            @error="(e) => ((e.target as HTMLImageElement).style.opacity = '0.2')"
          />
        </div>
        <div class="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span class="truncate text-sm font-medium">{{ item.title }}</span>
          <Badge
            v-if="connectedCount(item.service) > 0"
            variant="secondary"
            class="shrink-0"
          >
            {{ connectedCount(item.service) }} connected
          </Badge>
        </div>
      </div>
      <p
        class="line-clamp-2 text-xs text-muted-foreground group-hover:line-clamp-none"
      >
        {{ item.description }}
      </p>
      <div class="mt-auto flex items-center justify-between pt-2">
        <Badge variant="outline" class="text-xs">
          {{ item.mechanism === 'browser' ? 'Browser login' : 'API key' }}
        </Badge>
        <span class="text-xs text-primary opacity-0 group-hover:opacity-100">
          Connect →
        </span>
      </div>
    </button>
  </div>

  <p v-else class="text-sm text-muted-foreground">
    Catalogue is empty — see <code>api/src/slices/integration/domain/catalogue.ts</code>.
  </p>
</template>
