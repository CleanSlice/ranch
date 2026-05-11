<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { Button } from '#theme/components/ui/button';
import { IconExternalLink, IconLoader2, IconAlertTriangle } from '@tabler/icons-vue';


const props = defineProps<{
  open: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

type Phase = 'idle' | 'upgrading' | 'reloading';
const phase = ref<Phase>('idle');
const releaseNotes = ref<string | null>(null);
const notesLoading = ref(false);

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
});

async function loadReleaseNotes() {
  if (releaseNotes.value || notesLoading.value) return;
  notesLoading.value = true;
  try {
    const res = await fetch(
      `https://api.github.com/repos/CleanSlice/Ranch/releases/tags/v${props.latestVersion}`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (res.ok) {
      const data = (await res.json()) as { body?: string };
      releaseNotes.value = (data.body ?? '').slice(0, 2000);
    }
  } catch {
    // notes are optional — silent failure
  } finally {
    notesLoading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      phase.value = 'idle';
      void loadReleaseNotes();
    }
  },
  { immediate: true },
);

async function runUpgrade() {
  phase.value = 'upgrading';

  const config = useRuntimeConfig();
  const auth = useAuthStore();
  const apiUrl = config.public.apiUrl as string;
  const token = auth.accessToken;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);

  // Whether we get a clean 200 or the response is interrupted by the
  // nest --watch restart triggered by pulled source files, the right
  // thing is to give the watcher a moment to settle and then reload.
  // We swallow errors here because the API process is expected to die
  // mid-call as the watcher rebuilds.
  try {
    await fetch(`${apiUrl}/upgrade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
  } catch {
    // Expected when nest --watch restarts mid-call. Fall through to reload.
  } finally {
    clearTimeout(timer);
  }

  phase.value = 'reloading';
  setTimeout(() => {
    window.location.reload();
  }, 10_000);
}
</script>

<template>
  <DialogRoot v-model:open="isOpen">
    <DialogPortal>
      <DialogOverlay
        class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80"
      />
      <DialogContent
        class="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-xl -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg duration-200"
      >
        <div class="flex flex-col gap-1">
          <DialogTitle class="text-foreground text-lg font-semibold">
            Update Ranch
          </DialogTitle>
          <DialogDescription class="text-muted-foreground text-sm">
            v{{ currentVersion }} → v{{ latestVersion }}
          </DialogDescription>
        </div>

        <div v-if="phase === 'idle'" class="flex flex-col gap-3">
          <div
            class="max-h-72 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap"
          >
            <span v-if="notesLoading" class="text-muted-foreground">Loading release notes…</span>
            <span v-else-if="!releaseNotes" class="text-muted-foreground">No release notes available.</span>
            <span v-else>{{ releaseNotes }}</span>
          </div>
          <div class="rounded-md border border-amber-300/50 bg-amber-50/50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
            <div class="flex gap-2">
              <IconAlertTriangle class="size-4 shrink-0" />
              <div>
                Runs <code>git pull</code> + <code>bun install</code> + <code>prisma migrate deploy</code> in your local checkout. The page will reload in 10 seconds after the API finishes. If the API does not come back, restart <code>ranch dev</code> in your terminal.
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="phase === 'upgrading'" class="flex flex-col items-center gap-3 py-4">
          <IconLoader2 class="size-8 animate-spin text-primary" />
          <div class="text-sm font-medium">Updating Ranch…</div>
          <div class="text-xs text-muted-foreground text-center max-w-sm">
            Pulling code, installing dependencies, applying migrations. This can take 1–2 minutes.
          </div>
        </div>

        <div v-else-if="phase === 'reloading'" class="flex flex-col items-center gap-3 py-4">
          <IconLoader2 class="size-8 animate-spin text-primary" />
          <div class="text-sm font-medium">Reloading in 10 seconds…</div>
          <div class="text-xs text-muted-foreground text-center max-w-sm">
            Waiting for the API to restart with the new code.
          </div>
        </div>

        <div v-if="phase === 'idle'" class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" @click="emit('update:open', false)">
            Cancel
          </Button>
          <Button variant="outline" as-child>
            <a :href="releaseUrl" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5">
              View on GitHub
              <IconExternalLink class="size-3.5" />
            </a>
          </Button>
          <Button @click="runUpgrade">
            Update now
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
