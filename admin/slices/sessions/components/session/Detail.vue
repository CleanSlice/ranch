<script setup lang="ts">
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '#theme/components/ui/sheet';
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import { IconCopy, IconCheck, IconShieldLock } from '@tabler/icons-vue';
import type { ISessionData, SessionStatusTypes } from '#sessions/stores/session';

const props = defineProps<{ session: ISessionData | null }>();
const emit = defineEmits<{ (event: 'close'): void }>();

const open = computed({
  get: () => props.session !== null,
  set: (v: boolean) => {
    if (!v) emit('close');
  },
});

const copied = ref(false);
async function copyId() {
  if (!props.session) return;
  try {
    await navigator.clipboard.writeText(props.session.id);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1800);
  } catch {
    /* clipboard blocked — ignore */
  }
}

function statusInfo(status: SessionStatusTypes): {
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
  label: string;
  note: string;
} {
  switch (status) {
    case 'connected':
      return {
        variant: 'default',
        label: 'Active',
        note: 'Cookies are in place — agents can use this session right now.',
      };
    case 'pending':
      return {
        variant: 'secondary',
        label: 'Waiting for cookies',
        note: 'No cookies received yet. Open the extension and press Send cookies.',
      };
    case 'needs_login':
      return {
        variant: 'outline',
        label: 'Expired',
        note: 'The cookies expired. Log in again and re-send them from the extension.',
      };
    case 'revoked':
      return {
        variant: 'destructive',
        label: 'Revoked',
        note: 'This session was revoked and can no longer be used.',
      };
    default:
      return { variant: 'secondary', label: String(status), note: '' };
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
  <Sheet :open="open" @update:open="(v: boolean) => (open = v)">
    <SheetContent side="right" class="w-full sm:max-w-md">
      <SheetHeader>
        <SheetTitle class="capitalize">
          {{ session?.service ?? 'Session' }} session
        </SheetTitle>
        <SheetDescription>
          Cookies shared from your browser for
          <code class="rounded bg-muted px-1 py-0.5 text-xs">
            {{ session?.accountKey }}
          </code>
        </SheetDescription>
      </SheetHeader>

      <div v-if="session" class="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <!-- Status -->
        <div class="rounded-lg border bg-muted/30 p-3">
          <div class="flex items-center gap-2">
            <Badge :variant="statusInfo(session.status).variant">
              {{ statusInfo(session.status).label }}
            </Badge>
          </div>
          <p class="mt-2 text-xs text-muted-foreground">
            {{ statusInfo(session.status).note }}
          </p>
        </div>

        <!-- Detail rows -->
        <dl class="divide-y rounded-lg border">
          <div class="flex items-start justify-between gap-4 px-3 py-2.5">
            <dt class="text-xs text-muted-foreground">Service</dt>
            <dd class="text-sm font-medium capitalize">{{ session.service }}</dd>
          </div>
          <div class="flex items-start justify-between gap-4 px-3 py-2.5">
            <dt class="text-xs text-muted-foreground">Account</dt>
            <dd class="text-sm font-medium">{{ session.accountKey }}</dd>
          </div>
          <div class="flex items-start justify-between gap-4 px-3 py-2.5">
            <dt class="text-xs text-muted-foreground">Label</dt>
            <dd class="text-sm">{{ session.label || '—' }}</dd>
          </div>
          <div class="flex items-start justify-between gap-4 px-3 py-2.5">
            <dt class="text-xs text-muted-foreground">Connection</dt>
            <dd class="text-sm">Browser cookies</dd>
          </div>
          <div class="flex items-start justify-between gap-4 px-3 py-2.5">
            <dt class="text-xs text-muted-foreground">Connected</dt>
            <dd class="text-sm">{{ formatDate(session.createdAt) }}</dd>
          </div>
          <div class="flex items-start justify-between gap-4 px-3 py-2.5">
            <dt class="text-xs text-muted-foreground">Last updated</dt>
            <dd class="text-sm">{{ formatDate(session.updatedAt) }}</dd>
          </div>
        </dl>

        <!-- Session ID -->
        <div class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground">Session ID</span>
          <div class="flex items-center gap-2">
            <code
              class="flex-1 truncate rounded-md border bg-muted px-2.5 py-1.5 font-mono text-xs"
            >
              {{ session.id }}
            </code>
            <Button size="sm" variant="outline" @click="copyId">
              <component :is="copied ? IconCheck : IconCopy" class="size-4" />
              {{ copied ? 'Copied!' : 'Copy' }}
            </Button>
          </div>
        </div>

        <!-- Privacy note -->
        <div
          class="flex items-start gap-2.5 rounded-lg border border-dashed bg-muted/40 p-3"
        >
          <IconShieldLock class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p class="text-xs text-muted-foreground">
            The cookies themselves are stored encrypted and are only ever read
            by the agent runtime — they are never shown here or sent back to
            the browser.
          </p>
        </div>
      </div>

      <SheetFooter>
        <Button type="button" variant="outline" @click="emit('close')">
          Close
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
