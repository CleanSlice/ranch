<script setup lang="ts">
import type {
  ILlmCredentialData,
  ILlmHealthCheckResult,
} from '#llm/stores/llm';
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#theme/components/ui/table';
import { CheckCircle2, XCircle, Loader2, HelpCircle } from 'lucide-vue-next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#theme/components/ui/dropdown-menu';
import { IconDotsVertical, IconTrash } from '@tabler/icons-vue';

const llmStore = useLlmStore();

const { data: items, pending, refresh } = await useAsyncData(
  'admin-llms',
  () => llmStore.fetchAll(),
);

function mask(key: string) {
  if (!key) return '';
  if (key.length <= 8) return '•'.repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

const pendingRemoval = ref<ILlmCredentialData | null>(null);
const confirmRemoveOpen = computed({
  get: () => pendingRemoval.value !== null,
  set: (v: boolean) => {
    if (!v) pendingRemoval.value = null;
  },
});

async function onRemove() {
  const item = pendingRemoval.value;
  if (!item) return;
  pendingRemoval.value = null;
  await llmStore.remove(item.id);
  await refresh();
}

const healthChecking = ref<Record<string, boolean>>({});
const healthResults = ref<Record<string, ILlmHealthCheckResult>>({});

async function onCheckHealth(item: ILlmCredentialData) {
  healthChecking.value[item.id] = true;
  try {
    healthResults.value[item.id] = await llmStore.checkHealth(item.id);
  } catch (err) {
    healthResults.value[item.id] = {
      ok: false,
      latencyMs: 0,
      provider: item.provider,
      model: item.model,
      error: (err as Error).message,
    };
  } finally {
    healthChecking.value[item.id] = false;
  }
}

function healthTitle(item: ILlmCredentialData): string {
  if (healthChecking.value[item.id]) return 'Checking…';
  const r = healthResults.value[item.id];
  if (!r) return 'Not tested yet';
  if (r.ok) return `OK · ${r.latencyMs} ms`;
  return `Failed: ${r.error ?? 'unknown error'}`;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-end">
      <Button as-child>
        <NuxtLink to="/llms/create">New credential</NuxtLink>
      </Button>
    </div>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <div v-else-if="items?.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Provider</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>API key</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Health</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="item in items"
            :key="item.id"
            class="cursor-pointer"
            @click="navigateTo(`/llms/${item.id}/edit`)"
          >
            <TableCell class="font-medium">{{ item.provider }}</TableCell>
            <TableCell>
              <code class="text-xs">{{ item.model }}</code>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ item.label ?? '—' }}</TableCell>
            <TableCell>
              <code class="text-xs text-muted-foreground">{{ mask(item.apiKey) }}</code>
            </TableCell>
            <TableCell>
              <Badge :variant="item.status === 'active' ? 'default' : 'outline'">
                {{ item.status }}
              </Badge>
            </TableCell>
            <TableCell @click.stop>
              <div class="flex items-center gap-2" :title="healthTitle(item)">
                <Loader2
                  v-if="healthChecking[item.id]"
                  class="size-4 animate-spin text-muted-foreground"
                />
                <CheckCircle2
                  v-else-if="healthResults[item.id]?.ok"
                  class="size-4 text-emerald-600"
                />
                <XCircle
                  v-else-if="healthResults[item.id] && !healthResults[item.id].ok"
                  class="size-4 text-destructive"
                />
                <HelpCircle v-else class="size-4 text-muted-foreground" />
                <span
                  v-if="healthResults[item.id]?.ok"
                  class="text-xs text-muted-foreground"
                >
                  {{ healthResults[item.id].latencyMs }} ms
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  :disabled="healthChecking[item.id]"
                  @click="onCheckHealth(item)"
                >
                  Test
                </Button>
              </div>
            </TableCell>
            <TableCell @click.stop>
              <div class="flex justify-end gap-2">
                <Button size="sm" variant="outline" as-child>
                  <NuxtLink :to="`/llms/${item.id}/edit`">Edit</NuxtLink>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button size="sm" variant="ghost" class="size-8 p-0">
                      <span class="sr-only">Open menu</span>
                      <IconDotsVertical class="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      class="text-destructive focus:text-destructive"
                      @select="pendingRemoval = item"
                    >
                      <IconTrash class="size-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div
      v-else
      class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      No LLM credentials yet.
    </div>

    <ConfirmDialog
      v-model:open="confirmRemoveOpen"
      title="Delete credential"
      :description="pendingRemoval ? `Permanently delete the ${pendingRemoval.provider} credential${pendingRemoval.label ? ` “${pendingRemoval.label}”` : ''}? Agents using it will lose access on next restart.` : ''"
      confirm-label="Delete credential"
      @confirm="onRemove"
    />
  </div>
</template>
