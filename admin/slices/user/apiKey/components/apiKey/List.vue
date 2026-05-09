<script setup lang="ts">
import type { IApiKeyData } from '#apiKey/stores/apiKey';
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
import { IconTrash } from '@tabler/icons-vue';

defineProps<{ items: IApiKeyData[] }>();

defineEmits<{
  (event: 'remove', item: IApiKeyData): void;
}>();

function formatDate(value: string | null): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
</script>

<template>
  <div
    v-if="items.length"
    class="rounded-md border bg-card"
  >
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Key</TableHead>
          <TableHead>Scopes</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead>Created</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="item in items" :key="item.id">
          <TableCell class="font-medium">{{ item.name }}</TableCell>
          <TableCell>
            <code class="text-xs text-muted-foreground">rk_••••{{ item.prefix }}</code>
          </TableCell>
          <TableCell>
            <div class="flex flex-wrap gap-1">
              <Badge
                v-for="scope in item.scopes"
                :key="scope"
                variant="outline"
              >
                {{ scope }}
              </Badge>
            </div>
          </TableCell>
          <TableCell class="text-xs text-muted-foreground">
            {{ formatDate(item.lastUsedAt) }}
          </TableCell>
          <TableCell class="text-xs text-muted-foreground">
            {{ formatDate(item.expiresAt) }}
          </TableCell>
          <TableCell class="text-xs text-muted-foreground">
            {{ formatDate(item.createdAt) }}
          </TableCell>
          <TableCell>
            <div class="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                class="text-destructive hover:text-destructive"
                @click="$emit('remove', item)"
              >
                <IconTrash class="size-4" />
              </Button>
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
    No API keys yet.
  </div>
</template>
