<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import {
  IconDownload,
  IconCopy,
  IconCheck,
  IconPlugConnected,
  IconChevronDown,
  IconShieldLock,
} from '@tabler/icons-vue';

const props = defineProps<{ hasSessions: boolean }>();

const config = useRuntimeConfig();
const apiBase = computed(() =>
  String(config.public.apiUrl ?? '').replace(/\/+$/, ''),
);
const adminBase = computed(() => {
  if (typeof window === 'undefined') return '';
  return `${window.location.protocol}//${window.location.host}`;
});

// Expanded by default during onboarding (no sessions yet); collapsed into
// a slim bar once the user already has a session and just needs it as a
// reference. The user can still toggle either way.
const open = ref(!props.hasSessions);
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
  <section class="overflow-hidden rounded-xl border bg-card">
    <!-- Header bar — always visible, toggles the steps. -->
    <button
      type="button"
      class="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-accent/40"
      @click="open = !open"
    >
      <div
        class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
      >
        <IconPlugConnected class="size-5" />
      </div>
      <div class="min-w-0 flex-1">
        <h2 class="text-sm font-semibold">
          {{ hasSessions ? 'Connect another session' : 'Connect your first session' }}
        </h2>
        <p class="truncate text-xs text-muted-foreground">
          Install the Ranch Cookies extension, then share cookies in seconds.
        </p>
      </div>
      <span
        class="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground"
      >
        {{ open ? 'Hide' : 'Show steps' }}
        <IconChevronDown
          class="size-4 transition-transform duration-200"
          :class="open && 'rotate-180'"
        />
      </span>
    </button>

    <!-- Body — height animates via the grid-rows 0fr/1fr trick. -->
    <div
      class="grid transition-[grid-template-rows] duration-300 ease-out"
      :class="open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
    >
      <div class="overflow-hidden">
        <div class="space-y-5 border-t px-4 py-5">
          <p class="text-sm text-muted-foreground">
            The Ranch Cookies extension reads the cookies of a site you are
            already logged in to and ships them to Ranch — no passwords are
            ever typed or stored here.
          </p>

          <!-- Vertical stepper -->
          <ol class="relative">
            <!-- Step 1 -->
            <li class="relative flex gap-4 pb-6">
              <span
                class="absolute left-4 top-9 h-full w-px -translate-x-1/2 bg-border"
              />
              <span
                class="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-card text-sm font-semibold"
              >
                1
              </span>
              <div class="flex-1 pt-0.5">
                <h3 class="text-sm font-medium">Download the extension</h3>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  A ~3 KB folder that lives only on your machine — no store,
                  no auto-updates.
                </p>
                <Button size="sm" class="mt-2.5" @click="downloadExtension">
                  <IconDownload class="size-4" />
                  Download .zip
                </Button>
              </div>
            </li>

            <!-- Step 2 -->
            <li class="relative flex gap-4 pb-6">
              <span
                class="absolute left-4 top-9 h-full w-px -translate-x-1/2 bg-border"
              />
              <span
                class="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-card text-sm font-semibold"
              >
                2
              </span>
              <div class="flex-1 pt-0.5">
                <h3 class="text-sm font-medium">Load it into Chrome</h3>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  Open the extensions page (Chrome blocks navigating there
                  from a link — copy and paste it), turn on
                  <strong class="font-medium text-foreground">Developer mode</strong>,
                  click <strong class="font-medium text-foreground">Load unpacked</strong>
                  and pick the unzipped folder.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  class="mt-2.5"
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

            <!-- Step 3 -->
            <li class="relative flex gap-4 pb-6">
              <span
                class="absolute left-4 top-9 h-full w-px -translate-x-1/2 bg-border"
              />
              <span
                class="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-card text-sm font-semibold"
              >
                3
              </span>
              <div class="flex-1 pt-0.5">
                <h3 class="text-sm font-medium">Link it to Ranch</h3>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  Open the extension popup while on this page — it
                  detects Ranch automatically, just click
                  <strong class="font-medium text-foreground">Use this site</strong>.
                  Or paste the URLs below manually.
                </p>
                <div class="mt-2.5 space-y-2.5">
                  <!-- Admin URL -->
                  <div>
                    <span
                      class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      Admin URL
                    </span>
                    <div class="mt-1 flex items-center gap-2">
                      <code
                        class="flex-1 truncate rounded-md border bg-muted px-2.5 py-1.5 font-mono text-xs"
                      >
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
                  <!-- API URL -->
                  <div>
                    <span
                      class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      API URL
                    </span>
                    <div class="mt-1 flex items-center gap-2">
                      <code
                        class="flex-1 truncate rounded-md border bg-muted px-2.5 py-1.5 font-mono text-xs"
                      >
                        {{ apiBase }}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        @click="copy(apiBase, 'api-url')"
                      >
                        <component
                          :is="copied === 'api-url' ? IconCheck : IconCopy"
                          class="size-4"
                        />
                        {{ copied === 'api-url' ? 'Copied!' : 'Copy' }}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </li>

            <!-- Step 4 (last — no connecting line) -->
            <li class="relative flex gap-4">
              <span
                class="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-sm font-semibold text-primary-foreground"
              >
                4
              </span>
              <div class="flex-1 pt-0.5">
                <h3 class="text-sm font-medium">Share a session</h3>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  Log in on
                  <a
                    class="font-medium text-foreground underline underline-offset-2"
                    href="https://www.instagram.com/"
                    target="_blank"
                    rel="noopener"
                    >instagram.com</a
                  >,
                  <a
                    class="font-medium text-foreground underline underline-offset-2"
                    href="https://x.com/"
                    target="_blank"
                    rel="noopener"
                    >x.com</a
                  >
                  or any other site, click the Ranch icon →
                  <strong class="font-medium text-foreground">Send cookies</strong>.
                  The session appears in the list below within seconds.
                </p>
              </div>
            </li>
          </ol>

          <!-- Security note -->
          <div
            class="flex items-start gap-2.5 rounded-lg border border-dashed bg-muted/40 p-3"
          >
            <IconShieldLock class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p class="text-xs text-muted-foreground">
              The extension reads auth cookies from your current browser
              session — install it only on machines you control. It sends
              only to the Ranch URLs you paste.
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
