<script setup lang="ts">
import { Badge } from '#theme/components/ui/badge';
import { Button } from '#theme/components/ui/button';
import { IconEye, IconEyeOff, IconRefresh } from '@tabler/icons-vue';

const props = defineProps<{ id: string }>();

const store = useAgentSecretStore();

// Lazy so this sub-provider doesn't re-suspend the page once the parent's
// agent data resolves and this component mounts.
useAsyncData(
  `admin-agent-secrets-${props.id}`,
  () => store.fetchForAgent(props.id),
  { lazy: true },
);

const revealed = ref<Record<string, boolean>>({});

function mask(v: string): string {
  if (!v) return '';
  if (v.length <= 6) return '•'.repeat(v.length);
  return `${v.slice(0, 3)}${'•'.repeat(Math.max(6, v.length - 6))}${v.slice(-3)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

async function refresh() {
  await store.fetchForAgent(props.id);
  revealed.value = {};
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Provider</span>
        <Badge v-if="store.data" variant="outline" class="font-mono uppercase">
          {{ store.data.provider }}
        </Badge>
        <Badge v-else-if="store.loading" variant="outline">loading…</Badge>
        <Badge v-else variant="outline">—</Badge>
      </div>
      <Button
        size="sm"
        variant="outline"
        :disabled="store.loading"
        @click="refresh"
      >
        <IconRefresh class="size-4" :class="{ 'animate-spin': store.loading }" />
      </Button>
    </div>

    <div
      v-if="store.error"
      class="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
    >
      {{ store.error }}
    </div>

    <div
      v-if="!store.loading && store.data && store.data.secrets.length === 0"
      class="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground"
    >
      No secrets stored for this agent.
    </div>

    <dl
      v-else-if="store.data && store.data.secrets.length > 0"
      class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
    >
      <template v-for="entry in store.data.secrets" :key="entry.name">
        <dt class="font-mono text-xs text-muted-foreground" :title="entry.name">
          <div class="truncate">{{ entry.name }}</div>
          <div v-if="entry.updatedAt" class="text-[10px] text-muted-foreground/70">
            {{ formatDate(entry.updatedAt) }}
          </div>
        </dt>
        <dd class="min-w-0 break-all font-mono text-xs">
          <template v-if="!entry.value">
            <span class="italic text-muted-foreground">empty</span>
          </template>
          <template v-else-if="!revealed[entry.name]">
            {{ mask(entry.value) }}
          </template>
          <template v-else>
            {{ entry.value }}
          </template>
        </dd>
        <dd v-if="entry.value" class="flex justify-end">
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground"
            :title="revealed[entry.name] ? 'Hide' : 'Show'"
            @click="revealed[entry.name] = !revealed[entry.name]"
          >
            <IconEyeOff v-if="revealed[entry.name]" class="size-4" />
            <IconEye v-else class="size-4" />
          </button>
        </dd>
        <dd v-else />
      </template>
    </dl>
  </div>
</template>
