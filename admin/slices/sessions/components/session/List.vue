<script setup lang="ts">
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
import type { ISessionData, SessionStatusTypes } from '#sessions/stores/session';

defineProps<{ items: ISessionData[] }>();

defineEmits<{ (event: 'remove', item: ISessionData): void }>();

function statusBadge(status: SessionStatusTypes): {
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
  label: string;
} {
  switch (status) {
    case 'connected':
      return { variant: 'default', label: 'Active' };
    case 'pending':
      return { variant: 'secondary', label: 'Waiting for cookies' };
    case 'needs_login':
      return { variant: 'outline', label: 'Expired' };
    case 'revoked':
      return { variant: 'destructive', label: 'Revoked' };
    default:
      return { variant: 'secondary', label: String(status) };
  }
}

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
  <div v-if="items.length" class="rounded-md border bg-card">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Service</TableHead>
          <TableHead>Account</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="item in items" :key="item.id">
          <TableCell class="font-medium capitalize">{{ item.service }}</TableCell>
          <TableCell>
            <div class="flex flex-col">
              <span>{{ item.accountKey }}</span>
              <span v-if="item.label" class="text-xs text-muted-foreground">
                {{ item.label }}
              </span>
            </div>
          </TableCell>
          <TableCell>
            <Badge :variant="statusBadge(item.status).variant">
              {{ statusBadge(item.status).label }}
            </Badge>
          </TableCell>
          <TableCell class="text-xs text-muted-foreground">
            {{ formatDate(item.updatedAt) }}
          </TableCell>
          <TableCell>
            <div class="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                class="text-destructive hover:text-destructive"
                title="Remove session"
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
    class="rounded-md border border-dashed bg-card/50 px-6 py-12 text-center"
  >
    <p class="text-sm text-muted-foreground">
      No sessions yet. Install the extension above, log in on a site, and
      press <strong>Send cookies</strong> — the session appears here.
    </p>
  </div>
</template>
