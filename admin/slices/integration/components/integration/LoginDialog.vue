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
import { IconCopy, IconCheck, IconExternalLink } from '@tabler/icons-vue';
import type {
  IIntegrationAccountData,
  IIntegrationCatalogueItem,
  ILoginInstructionData,
} from '#integration/stores/integration';

const props = defineProps<{
  payload: {
    account: IIntegrationAccountData;
    connection: ILoginInstructionData;
  } | null;
  catalogue: IIntegrationCatalogueItem[];
}>();

const emit = defineEmits<{
  (event: 'close', needsRefresh: boolean): void;
}>();

const store = useIntegrationStore();

const open = computed(() => props.payload !== null);
const status = ref<string | null>(null);
const pollHandle = ref<ReturnType<typeof setInterval> | null>(null);
const copied = ref<string | null>(null);

const catalogueItem = computed(() =>
  props.catalogue.find((c) => c.service === props.payload?.account.service),
);

// Poll the integration row — when the extension's import-state lands
// the status flips to "connected" and we auto-close.
watch(
  () => props.payload,
  (payload) => {
    if (pollHandle.value) {
      clearInterval(pollHandle.value);
      pollHandle.value = null;
    }
    status.value = payload?.account.status ?? null;
    copied.value = null;
    if (!payload) return;
    pollHandle.value = setInterval(async () => {
      const fresh = await store.refreshOne(payload.account.id);
      if (!fresh) return;
      status.value = fresh.status;
      if (fresh.status === 'connected') {
        emit('close', true);
      }
    }, 4000);
  },
  { immediate: true },
);

onUnmounted(() => {
  if (pollHandle.value) clearInterval(pollHandle.value);
});

function onSheetUpdate(v: boolean) {
  if (!v) emit('close', false);
}

async function copy(text: string, key: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = key;
    setTimeout(() => {
      if (copied.value === key) copied.value = null;
    }, 1800);
  } catch {
    /* clipboard blocked — user can copy manually */
  }
}

function openSite() {
  if (props.payload?.connection.siteUrl) {
    window.open(props.payload.connection.siteUrl, '_blank', 'noopener');
  }
}
</script>

<template>
  <Sheet :open="open" @update:open="onSheetUpdate">
    <SheetContent side="right" class="w-full sm:max-w-2xl">
      <SheetHeader>
        <SheetTitle>
          Log in to {{ catalogueItem?.title ?? payload?.account.service }}
          <span class="text-muted-foreground">
            — {{ payload?.account.accountKey }}
          </span>
        </SheetTitle>
        <SheetDescription>
          Log in to the service in your normal browser, then push cookies to
          Ranch with the Cookies extension. No VNC, no shared infrastructure
          — your session never leaves this machine until you click Send.
        </SheetDescription>
      </SheetHeader>

      <div class="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        <ol class="space-y-4">
          <li class="flex items-start gap-3">
            <span
              class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
              >1</span
            >
            <div class="flex-1">
              <p class="text-sm">
                Open
                <strong>{{ catalogueItem?.title ?? payload?.account.service }}</strong>
                in a new tab and sign in to your
                <code class="rounded bg-muted px-1 py-0.5 text-xs">
                  @{{ payload?.account.accountKey }}
                </code>
                account.
              </p>
              <Button size="sm" class="mt-2" @click="openSite">
                <IconExternalLink class="size-4" />
                Open {{ catalogueItem?.title ?? 'site' }}
              </Button>
            </div>
          </li>

          <li class="flex items-start gap-3">
            <span
              class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
              >2</span
            >
            <p class="flex-1 text-sm">
              Click the
              <strong>Ranch Cookies</strong>
              extension icon in your toolbar. If it isn't installed yet, the
              full install guide lives on
              <a
                class="underline"
                href="/integrations"
                target="_blank"
                rel="noopener"
                >the Integrations page</a>.
            </p>
          </li>

          <li class="flex items-start gap-3">
            <span
              class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
              >3</span
            >
            <p class="flex-1 text-sm">
              In the popup, make sure <strong>Integration</strong> mode is
              selected (it auto-detects this site), the account label says
              <code class="rounded bg-muted px-1 py-0.5 text-xs">
                {{ payload?.account.accountKey }}
              </code>
              , and click <strong>Send cookies</strong>.
            </p>
          </li>

          <li class="flex items-start gap-3">
            <span
              class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
              >4</span
            >
            <p class="flex-1 text-sm">
              Once cookies arrive, this dialog auto-closes and the status flips
              to
              <Badge variant="default" class="text-[10px]">Connected</Badge>
              (auto-refresh every 4s).
            </p>
          </li>
        </ol>

        <div class="rounded-md border bg-muted/30 p-3 text-xs">
          <p class="mb-2 font-medium">Forward to the user via chat:</p>
          <pre class="overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">{{ payload?.connection.instructions }}</pre>
          <Button
            size="sm"
            variant="outline"
            class="mt-2"
            @click="copy(payload?.connection.instructions ?? '', 'instructions')"
          >
            <component
              :is="copied === 'instructions' ? IconCheck : IconCopy"
              class="size-4"
            />
            {{ copied === 'instructions' ? 'Copied!' : 'Copy instructions' }}
          </Button>
        </div>

        <div class="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Status: <strong>{{ status ?? 'unknown' }}</strong>
          </span>
          <span v-if="pollHandle">Auto-refresh every 4s</span>
        </div>
      </div>

      <SheetFooter>
        <Button variant="outline" @click="emit('close', false)">Close</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
