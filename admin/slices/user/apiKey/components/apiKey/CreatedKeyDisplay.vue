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
import { IconCopy, IconCheck, IconAlertTriangle } from '@tabler/icons-vue';
import type { ICreatedApiKey } from '#apiKey/stores/apiKey';

const props = defineProps<{ created: ICreatedApiKey | null }>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const apiUrl = useRuntimeConfig().public.apiUrl as string;

const isOpen = computed({
  get: () => props.created !== null,
  set: (v: boolean) => {
    if (!v) emit('close');
  },
});

const copied = ref(false);

watch(
  () => props.created,
  () => {
    copied.value = false;
  },
);

async function copyKey() {
  if (!props.created) return;
  try {
    await navigator.clipboard.writeText(props.created.key);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    /* clipboard unavailable — user can copy manually */
  }
}
</script>

<template>
  <Sheet
    :open="isOpen"
    @update:open="(v: boolean) => (isOpen = v)"
  >
    <SheetContent side="right" class="w-full sm:max-w-xl">
      <SheetHeader>
        <SheetTitle class="flex items-center gap-2">
          <IconCheck class="size-5 text-emerald-600" />
          API key created
        </SheetTitle>
        <SheetDescription>
          Copy the key now. We don't store the plaintext — close this panel and it's gone forever. You can revoke the key anytime from the list.
        </SheetDescription>
      </SheetHeader>

      <div v-if="created" class="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        <div
          class="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        >
          <IconAlertTriangle class="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>Save it now.</strong> This is the one and only time the
            full key is shown. Once you close this panel, only its prefix
            (<code class="font-mono">rk_••••{{ created.apiKey.prefix }}</code>) remains visible.
          </span>
        </div>

        <div class="grid gap-2">
          <span class="text-sm font-medium">Plaintext key</span>
          <div class="flex items-stretch gap-2">
            <code
              class="flex-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs"
            >
              {{ created.key }}
            </code>
            <Button
              type="button"
              variant="outline"
              class="shrink-0"
              @click="copyKey"
            >
              <IconCheck v-if="copied" class="size-4" />
              <IconCopy v-else class="size-4" />
              {{ copied ? 'Copied' : 'Copy' }}
            </Button>
          </div>
        </div>

        <div class="grid gap-1 text-xs text-muted-foreground">
          <span><strong class="font-medium text-foreground">Name:</strong> {{ created.apiKey.name }}</span>
          <span>
            <strong class="font-medium text-foreground">Scopes:</strong>
            {{ created.apiKey.scopes.join(', ') }}
          </span>
          <span v-if="created.apiKey.expiresAt">
            <strong class="font-medium text-foreground">Expires:</strong>
            {{ new Date(created.apiKey.expiresAt).toLocaleString() }}
          </span>
        </div>

        <div class="grid gap-2">
          <span class="text-sm font-medium">Use it</span>
          <p class="text-xs text-muted-foreground">
            <code class="rounded bg-muted px-1 py-0.5">sub</code> is the JWT
            subject — Ranch uses it as the visitor's <code class="rounded bg-muted px-1 py-0.5">clientId</code>
            inside the bridle hub (message routing, chat history). Use whatever id you have in your system.
          </p>
          <pre
            class="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs"
          ><code>curl -X POST &quot;{{ apiUrl }}/auth/embed/token&quot; \
  -H &quot;Authorization: Bearer $RANCH_EMBED_KEY&quot; \
  -H &quot;Content-Type: application/json&quot; \
  -d '{&quot;sub&quot;:&quot;user-123&quot;,&quot;email&quot;:&quot;alice@example.com&quot;}'</code></pre>
        </div>
      </div>

      <SheetFooter>
        <Button @click="emit('close')">Done</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
