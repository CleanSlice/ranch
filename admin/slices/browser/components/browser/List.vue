<script setup lang="ts">
import {
  type IBrowserSessionData,
  BrowserSessionStatusTypes,
} from '#browser/stores/browser';
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
import { IconRefresh, IconTrash, IconLogin } from '@tabler/icons-vue';

defineProps<{ items: IBrowserSessionData[] }>();

defineEmits<{
  (event: 'login', item: IBrowserSessionData): void;
  (event: 'reset', item: IBrowserSessionData): void;
  (event: 'remove', item: IBrowserSessionData): void;
}>();

function formatDate(value: string | null): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

// Map status enum values to badge variant + label so the column reads at
// a glance — green/active for working sessions, yellow for needs-login,
// red for stuck (the "browser_play timed out 120s" case).
function statusBadge(status: BrowserSessionStatusTypes): {
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
  label: string;
} {
  switch (status) {
    case BrowserSessionStatusTypes.Active:
      return { variant: 'default', label: 'Active' };
    case BrowserSessionStatusTypes.Idle:
      return { variant: 'secondary', label: 'Idle' };
    case BrowserSessionStatusTypes.NeedsLogin:
      return { variant: 'outline', label: 'Needs login' };
    case BrowserSessionStatusTypes.Expired:
      return { variant: 'destructive', label: 'Expired' };
    case BrowserSessionStatusTypes.Stuck:
      return { variant: 'destructive', label: 'Stuck' };
    default:
      return { variant: 'secondary', label: String(status) };
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
          <TableHead>Account</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead>Created</TableHead>
          <TableHead class="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="item in items" :key="item.id">
          <TableCell class="font-medium">{{ item.accountKey }}</TableCell>
          <TableCell>
            <Badge :variant="statusBadge(item.status).variant">
              {{ statusBadge(item.status).label }}
            </Badge>
          </TableCell>
          <TableCell class="text-xs text-muted-foreground">
            {{ formatDate(item.lastUsedAt) }}
          </TableCell>
          <TableCell class="text-xs text-muted-foreground">
            {{ formatDate(item.createdAt) }}
          </TableCell>
          <TableCell>
            <div class="flex justify-end gap-1">
              <Button
                v-if="
                  item.status === BrowserSessionStatusTypes.NeedsLogin ||
                  item.status === BrowserSessionStatusTypes.Expired
                "
                size="sm"
                variant="default"
                @click="$emit('login', item)"
              >
                <IconLogin class="size-4" />
                Log in
              </Button>
              <Button
                v-if="item.status === BrowserSessionStatusTypes.Stuck"
                size="sm"
                variant="outline"
                @click="$emit('reset', item)"
              >
                <IconRefresh class="size-4" />
                Reset
              </Button>
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
    class="rounded-md border border-dashed bg-card/50 px-6 py-12 text-center"
  >
    <p class="text-sm text-muted-foreground">
      No browser sessions yet. They appear automatically when an agent first
      needs one — or you can add one upfront with the button above.
    </p>
  </div>
</template>
