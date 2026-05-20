<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { IconDownload, IconCopy, IconCheck } from '@tabler/icons-vue';

const config = useRuntimeConfig();
const apiBase = computed(() =>
  String(config.public.apiUrl ?? '').replace(/\/+$/, ''),
);
const adminBase = computed(() => {
  if (typeof window === 'undefined') return '';
  return `${window.location.protocol}//${window.location.host}`;
});

const copied = ref<string | null>(null);

async function copy(text: string, key: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = key;
    setTimeout(() => {
      if (copied.value === key) copied.value = null;
    }, 1800);
  } catch {
    /* clipboard blocked — ignore, user can copy manually */
  }
}

function downloadExtension() {
  if (!apiBase.value) return;
  window.open(`${apiBase.value}/integrations/extension/download`, '_blank');
}
</script>

<template>
  <section class="space-y-4 rounded-lg border bg-card p-5">
    <div>
      <h2 class="text-lg font-medium">Connect a session</h2>
      <p class="text-sm text-muted-foreground">
        The Ranch Cookies extension reads the cookies of a site you are
        already logged in to and sends them here. Install it once, then
        share a session in seconds.
      </p>
    </div>

    <ol class="space-y-3 text-sm">
      <li class="flex items-start gap-3">
        <span
          class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
          >1</span
        >
        <div class="flex-1">
          <p>
            Download and unzip the extension.
            <span class="block text-xs text-muted-foreground">
              One folder, ~3 KB. Lives only on your machine — never
              auto-updates from a store.
            </span>
          </p>
          <Button size="sm" class="mt-2" @click="downloadExtension">
            <IconDownload class="size-4" />
            Download ranch-cookies-extension.zip
          </Button>
        </div>
      </li>

      <li class="flex items-start gap-3">
        <span
          class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
          >2</span
        >
        <div class="flex-1">
          <p>
            Open
            <code class="rounded bg-muted px-1 py-0.5 text-xs">chrome://extensions/</code>
            in a new tab. Chrome blocks programmatic navigation there, so
            copy it and paste it manually.
          </p>
          <Button
            size="sm"
            variant="outline"
            class="mt-2"
            @click="copy('chrome://extensions/', 'chrome-url')"
          >
            <component
              :is="copied === 'chrome-url' ? IconCheck : IconCopy"
              class="size-4"
            />
            {{ copied === 'chrome-url' ? 'Copied!' : 'Copy chrome://extensions/' }}
          </Button>
        </div>
      </li>

      <li class="flex items-start gap-3">
        <span
          class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
          >3</span
        >
        <p>
          Toggle <strong>Developer mode</strong> on (top-right), click
          <strong>Load unpacked</strong>, and pick the unzipped folder.
        </p>
      </li>

      <li class="flex items-start gap-3">
        <span
          class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
          >4</span
        >
        <div class="flex-1">
          <p>Open the extension popup and paste this admin URL when prompted:</p>
          <div class="mt-2 flex items-center gap-2">
            <code class="flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">
              {{ adminBase }}
            </code>
            <Button
              size="sm"
              variant="outline"
              @click="copy(adminBase, 'admin-url')"
            >
              <component
                :is="copied === 'admin-url' ? IconCheck : IconCopy"
                class="size-4"
              />
              {{ copied === 'admin-url' ? 'Copied!' : 'Copy' }}
            </Button>
          </div>
        </div>
      </li>

      <li class="flex items-start gap-3">
        <span
          class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
          >5</span
        >
        <p>
          Log in on
          <a
            class="underline"
            href="https://www.instagram.com/"
            target="_blank"
            rel="noopener"
            >instagram.com</a
          >,
          <a class="underline" href="https://x.com/" target="_blank" rel="noopener">x.com</a>,
          or any other site. Click the Ranch extension icon →
          <strong>Send cookies</strong>. The session appears in the list
          below.
        </p>
      </li>
    </ol>

    <p class="rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
      <strong class="text-foreground">Heads-up:</strong> the extension reads
      your auth cookies from your current browser session — install it only
      on machines you control. It sends only to the admin URL you paste.
    </p>
  </section>
</template>
