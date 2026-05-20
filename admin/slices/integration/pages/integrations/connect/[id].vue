<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import { IconExternalLink, IconCheck, IconClipboardCheck } from '@tabler/icons-vue';

const route = useRoute();
const store = useIntegrationStore();

const accountId = computed(() => String(route.params.id));

// One-time fetch — connect URL is typically opened from a Telegram link
// where the user has just one integration to deal with.
const { pending, refresh } = await useAsyncData(
  `admin-integrations-connect-${accountId.value}`,
  async () => {
    await store.fetchCatalogue();
    return store.refreshOne(accountId.value);
  },
);

const account = computed(() =>
  store.items.find((a) => a.id === accountId.value),
);
const catalogueItem = computed(() =>
  store.catalogue.find((c) => c.service === account.value?.service),
);

const connected = computed(() => account.value?.status === 'connected');

// Light polling — when the extension push lands, the row flips to
// "connected" and the page swaps to the success state without a manual
// reload.
const pollHandle = ref<ReturnType<typeof setInterval> | null>(null);
onMounted(() => {
  pollHandle.value = setInterval(() => refresh(), 4000);
});
onUnmounted(() => {
  if (pollHandle.value) clearInterval(pollHandle.value);
});

function openSite() {
  const url = catalogueItem.value?.loginUrl;
  if (url) window.open(url, '_blank', 'noopener');
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6">
    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <div
      v-else-if="!account"
      class="rounded-md border border-dashed bg-card/50 px-6 py-12 text-center"
    >
      <p class="text-sm text-muted-foreground">
        Integration not found, or you don't have access. Open the admin
        <a class="underline" href="/integrations">Integrations page</a>
        to manage your accounts.
      </p>
    </div>

    <template v-else>
      <div>
        <h1 class="text-2xl font-semibold">
          Connect {{ catalogueItem?.title ?? account.service }}
        </h1>
        <p class="text-sm text-muted-foreground">
          Account
          <code class="rounded bg-muted px-1 py-0.5 text-xs">
            @{{ account.accountKey }}
          </code>
        </p>
      </div>

      <Card v-if="connected" class="border-emerald-500/40 bg-emerald-500/5">
        <CardHeader>
          <CardTitle class="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <IconCheck class="size-5" />
            Already connected
          </CardTitle>
          <CardDescription>
            Cookies are in place — the agent can act on this account right
            now. If a tool returns
            <code class="rounded bg-muted px-1 py-0.5 text-xs">needsLogin</code>
            again later, return here and re-send cookies.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button @click="openSite">
            <IconExternalLink class="size-4" />
            Open {{ catalogueItem?.title ?? 'site' }}
          </Button>
        </CardContent>
      </Card>

      <template v-else>
        <Card>
          <CardHeader>
            <CardTitle>1. Install the Ranch Cookies extension</CardTitle>
            <CardDescription>
              One-time setup. Skip if it's already in your Chrome toolbar.
            </CardDescription>
          </CardHeader>
          <CardContent class="flex flex-col gap-2">
            <a class="text-sm underline" href="/integrations" target="_blank" rel="noopener">
              Full install guide on the Integrations page
            </a>
            <p class="text-xs text-muted-foreground">
              Download zip → enable Developer mode at
              <code class="rounded bg-muted px-1 py-0.5 text-[11px]">chrome://extensions/</code>
              → Load unpacked → paste this Ranch admin URL in the extension
              popup on first run.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Log in on the service</CardTitle>
            <CardDescription>
              In your normal browser — your session stays on your machine
              until the extension explicitly sends it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button @click="openSite">
              <IconExternalLink class="size-4" />
              Open {{ catalogueItem?.title ?? 'site' }} (
              <code>@{{ account.accountKey }}</code>
              )
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Send cookies</CardTitle>
            <CardDescription>
              Once you're logged in on the site, click the Ranch Cookies
              extension icon → switch to
              <Badge variant="secondary" class="text-[10px]">Integration</Badge>
              mode (auto-detected) → press
              <strong>Send cookies</strong>. The status below auto-refreshes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div class="flex items-center gap-3 text-sm">
              <span class="text-muted-foreground">Current status:</span>
              <Badge :variant="account.status === 'connected' ? 'default' : 'outline'">
                {{ account.status }}
              </Badge>
              <span class="text-xs text-muted-foreground">
                Refreshing every 4s
              </span>
            </div>
          </CardContent>
        </Card>

        <details class="rounded-md border bg-muted/30 p-3 text-xs">
          <summary class="cursor-pointer font-medium">
            Don't want the extension? Paste cookies manually.
          </summary>
          <p class="mt-2 text-muted-foreground">
            Open
            <a class="underline" :href="`/integrations`">the Integrations page</a>
            → find this account → click
            <IconClipboardCheck class="inline size-3" />
            <strong>Cookies</strong> → paste a Cookie-Editor JSON export.
            Same result as the extension, just one extra step.
          </p>
        </details>
      </template>
    </template>
  </div>
</template>
