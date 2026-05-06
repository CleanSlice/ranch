<script setup lang="ts">
import type { IMcpServerData } from '#mcpServer/stores/mcpServer';
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import { Skeleton } from '#theme/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#theme/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#theme/components/ui/dropdown-menu';
import { IconDotsVertical, IconShield, IconTrash } from '@tabler/icons-vue';

const mcpServerStore = useMcpServerStore();

const { data: items, pending } = await useAsyncData(
  'admin-mcp-servers',
  () => mcpServerStore.fetchAll(),
);

const pendingRemoval = ref<IMcpServerData | null>(null);
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
  await mcpServerStore.remove(item.id);
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">MCP servers</h1>
        <p class="text-sm text-muted-foreground">
          Tool servers that agents connect to. Attach them to templates so spawned agents inherit the toolset.
        </p>
      </div>
      <Button as-child>
        <NuxtLink to="/mcps/create">New MCP server</NuxtLink>
      </Button>
    </div>

    <div v-if="pending && !items" class="rounded-md border bg-card p-2">
      <div v-for="i in 3" :key="i" class="flex items-center gap-4 px-2 py-3 border-b last:border-b-0">
        <Skeleton class="h-4 w-40" />
        <Skeleton class="h-4 w-24" />
        <Skeleton class="h-5 w-16 rounded-full" />
      </div>
    </div>

    <div v-else-if="items?.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>URL</TableHead>
            <TableHead>Transport</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead>Templates</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="m in items"
            :key="m.id"
            class="cursor-pointer"
            @click="navigateTo(`/mcps/${m.id}`)"
          >
            <TableCell class="font-medium max-w-[280px]">
              <div class="flex items-center gap-2 min-w-0">
                <span class="truncate">{{ m.name }}</span>
                <Badge v-if="m.builtIn" variant="secondary" class="gap-1 shrink-0">
                  <IconShield class="size-3" /> Built-in
                </Badge>
              </div>
              <p
                v-if="m.description"
                :title="m.description"
                class="text-xs text-muted-foreground truncate"
              >
                {{ m.description }}
              </p>
            </TableCell>
            <TableCell class="text-muted-foreground font-mono text-xs max-w-[260px] truncate" :title="m.url">{{ m.url }}</TableCell>
            <TableCell class="text-muted-foreground">{{ m.transport }}</TableCell>
            <TableCell>
              <Badge :variant="m.enabled ? 'default' : 'outline'">
                {{ m.enabled ? 'On' : 'Off' }}
              </Badge>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ m.templateIds.length }}</TableCell>
            <TableCell @click.stop>
              <div class="flex justify-end gap-2">
                <Button size="sm" variant="outline" as-child>
                  <NuxtLink :to="`/mcps/${m.id}`">Edit</NuxtLink>
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
                      :disabled="m.builtIn"
                      :title="m.builtIn ? 'Built-in entry — disable instead' : ''"
                      @select="pendingRemoval = m"
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

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      No MCP servers yet.
    </div>

    <ConfirmDialog
      v-model:open="confirmRemoveOpen"
      title="Delete MCP server"
      :description="pendingRemoval ? `Permanently delete “${pendingRemoval.name}”? Templates referencing it will be detached.` : ''"
      confirm-label="Delete"
      @confirm="onRemove"
    />
  </div>
</template>
