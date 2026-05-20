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
import { IconLogin, IconKey, IconTrash, IconClipboardCheck, IconUsers } from '@tabler/icons-vue';
import type {
  IIntegrationAccountData,
  IIntegrationCatalogueItem,
  IntegrationStatusTypes,
} from '#integration/stores/integration';

const props = defineProps<{
  items: IIntegrationAccountData[];
  catalogue: IIntegrationCatalogueItem[];
}>();

defineEmits<{
  (event: 'login', item: IIntegrationAccountData): void;
  (event: 'secret', item: IIntegrationAccountData): void;
  (event: 'importCookies', item: IIntegrationAccountData): void;
  (event: 'aliases', item: IIntegrationAccountData): void;
  (event: 'remove', item: IIntegrationAccountData): void;
}>();

function catalogueFor(service: string): IIntegrationCatalogueItem | undefined {
  return props.catalogue.find((c) => c.service === service);
}

function statusBadge(status: IntegrationStatusTypes): {
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
  label: string;
} {
  switch (status) {
    case 'connected':
      return { variant: 'default', label: 'Connected' };
    case 'pending':
      return { variant: 'secondary', label: 'Pending' };
    case 'needs_login':
      return { variant: 'outline', label: 'Needs login' };
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
          <TableCell class="font-medium">
            <div class="flex items-center gap-2">
              <img
                v-if="catalogueFor(item.service)?.iconUrl"
                :src="catalogueFor(item.service)!.iconUrl"
                :alt="catalogueFor(item.service)!.title"
                class="size-5"
                referrerpolicy="no-referrer"
                @error="(e) => ((e.target as HTMLImageElement).style.opacity = '0.2')"
              />
              <span>{{ catalogueFor(item.service)?.title ?? item.service }}</span>
            </div>
          </TableCell>
          <TableCell>
            <div class="flex flex-col gap-1">
              <span>{{ item.accountKey }}</span>
              <span v-if="item.label" class="text-xs text-muted-foreground">
                {{ item.label }}
              </span>
              <div v-if="item.aliases.length" class="flex flex-wrap gap-1">
                <Badge
                  v-for="alias in item.aliases"
                  :key="alias"
                  variant="outline"
                  class="font-mono text-[10px]"
                  :title="`Visible to runtime as ctx.from=${alias}`"
                >
                  {{ alias }}
                </Badge>
              </div>
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
            <div class="flex justify-end gap-1">
              <Button
                v-if="
                  item.mechanism === 'browser' &&
                  (item.status === 'pending' || item.status === 'needs_login')
                "
                size="sm"
                variant="default"
                @click="$emit('login', item)"
              >
                <IconLogin class="size-4" />
                Log in
              </Button>
              <Button
                v-if="item.mechanism === 'browser'"
                size="sm"
                variant="outline"
                title="Import cookies from your own browser instead of VNC"
                @click="$emit('importCookies', item)"
              >
                <IconClipboardCheck class="size-4" />
                Cookies
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Edit runtime identities (aliases)"
                @click="$emit('aliases', item)"
              >
                <IconUsers class="size-4" />
              </Button>
              <Button
                v-if="item.mechanism === 'secret'"
                size="sm"
                :variant="item.status === 'connected' ? 'outline' : 'default'"
                @click="$emit('secret', item)"
              >
                <IconKey class="size-4" />
                {{ item.status === 'connected' ? 'Rotate' : 'Set key' }}
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
      Nothing connected yet. Pick a service above to get started.
    </p>
  </div>
</template>
