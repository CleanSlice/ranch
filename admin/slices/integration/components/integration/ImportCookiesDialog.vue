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
import { Label } from '#theme/components/ui/label';
import { Input } from '#theme/components/ui/input';
import type {
  IIntegrationAccountData,
  IIntegrationCatalogueItem,
} from '#integration/stores/integration';

const props = defineProps<{
  account: IIntegrationAccountData | null;
  catalogue: IIntegrationCatalogueItem[];
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'saved', account: IIntegrationAccountData): void;
}>();

const store = useIntegrationStore();

const open = computed(() => props.account !== null);
const json = ref('');
const userAgent = ref('');
const submitting = ref(false);
const submitError = ref<string | null>(null);

const catalogueItem = computed(() =>
  props.catalogue.find((c) => c.service === props.account?.service),
);

watch(
  () => props.account,
  () => {
    json.value = '';
    userAgent.value = '';
    submitError.value = null;
    submitting.value = false;
  },
);

function onSheetUpdate(v: boolean) {
  if (!v) emit('close');
}

interface IParseResult {
  cookies: unknown[];
  origins: unknown[];
  userAgent?: string;
}

/**
 * Accepts three shapes:
 *   1) Playwright storageState wrapper: { userAgent, storageState: { cookies, origins } }
 *   2) Plain Playwright storageState: { cookies, origins }
 *   3) Cookie-Editor array: [ { name, value, domain, ... }, ... ]
 */
function parsePayload(text: string): IParseResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) {
    return { cookies: parsed, origins: [] };
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (obj.storageState && typeof obj.storageState === 'object') {
      const ss = obj.storageState as Record<string, unknown>;
      return {
        cookies: Array.isArray(ss.cookies) ? (ss.cookies as unknown[]) : [],
        origins: Array.isArray(ss.origins) ? (ss.origins as unknown[]) : [],
        userAgent:
          typeof obj.userAgent === 'string'
            ? (obj.userAgent as string)
            : undefined,
      };
    }
    if (Array.isArray(obj.cookies)) {
      return {
        cookies: obj.cookies as unknown[],
        origins: Array.isArray(obj.origins) ? (obj.origins as unknown[]) : [],
      };
    }
  }
  return null;
}

const parsed = computed(() => parsePayload(json.value));
const valid = computed(
  () => parsed.value !== null && parsed.value.cookies.length > 0,
);

async function onSubmit() {
  if (!valid.value || submitting.value || !props.account || !parsed.value)
    return;
  submitting.value = true;
  submitError.value = null;
  try {
    // Manual UA input wins over what the JSON payload claims, so users
    // can override if their Cookie-Editor export omitted it.
    const ua = userAgent.value.trim() || parsed.value.userAgent;
    const account = await store.importCookies(props.account.id, {
      cookies: parsed.value.cookies,
      origins: parsed.value.origins,
      userAgent: ua,
    });
    if (!account) throw new Error('Empty response');
    emit('saved', account);
  } catch (err) {
    submitError.value = (err as Error).message;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Sheet :open="open" @update:open="onSheetUpdate">
    <SheetContent side="right" class="w-full sm:max-w-2xl">
      <SheetHeader>
        <SheetTitle>
          Import cookies for {{ catalogueItem?.title ?? account?.service }}
          <span v-if="account" class="text-muted-foreground">
            — {{ account.accountKey }}
          </span>
        </SheetTitle>
        <SheetDescription>
          Skip the VNC login. Paste a Playwright
          <code class="rounded bg-muted px-1 py-0.5 text-xs">storageState</code>
          JSON (or a Cookie-Editor export) — the runtime falls back to this
          file when no per-agent state exists, so one import covers every
          agent you own.
        </SheetDescription>
      </SheetHeader>

      <form
        class="flex flex-1 flex-col gap-5 overflow-y-auto p-4"
        @submit.prevent="onSubmit"
      >
        <details class="rounded-md border bg-muted/30 p-3 text-xs">
          <summary class="cursor-pointer font-medium">
            How to export cookies (Cookie-Editor)
          </summary>
          <ol class="mt-2 list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>
              Install
              <a
                class="underline"
                href="https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm"
                target="_blank"
                rel="noopener"
                >Cookie-Editor</a
              >
              in your normal Chrome.
            </li>
            <li>
              Log in to
              <strong>{{ catalogueItem?.loginUrl ?? account?.service }}</strong>
              as usual.
            </li>
            <li>
              Open Cookie-Editor →
              <strong>Export → Export as JSON</strong> (or Playwright
              storageState).
            </li>
            <li>Paste the JSON below. The UA field is auto-filled if the
              export includes it.</li>
          </ol>
        </details>

        <div class="grid gap-2">
          <Label for="integration-cookies-json">storageState JSON</Label>
          <textarea
            id="integration-cookies-json"
            v-model="json"
            class="min-h-[200px] w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
            placeholder='[{"name":"sessionid","value":"…","domain":".instagram.com",…}]'
            spellcheck="false"
          ></textarea>
          <p v-if="json.length && !parsed" class="text-xs text-destructive">
            Couldn’t parse JSON. Expected an array of cookies, a Playwright
            storageState object, or a wrapper with userAgent + storageState.
          </p>
          <p v-else-if="parsed" class="text-xs text-muted-foreground">
            Detected {{ parsed.cookies.length }} cookies,
            {{ parsed.origins.length }} origins
            <span v-if="parsed.userAgent"> — UA captured from JSON</span>.
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="integration-cookies-ua">User-Agent (recommended)</Label>
          <Input
            id="integration-cookies-ua"
            v-model="userAgent"
            placeholder="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/…"
            autocomplete="off"
            spellcheck="false"
          />
          <p class="text-xs text-muted-foreground">
            CRITICAL for Meta / TikTok — sessions die when UA shifts between
            capture and replay. Open
            <code class="rounded bg-muted px-1 py-0.5 text-[10px]"
              >chrome://version/</code
            >
            in the same browser you exported cookies from and copy the
            User-Agent string.
          </p>
        </div>

        <p v-if="submitError" class="text-xs text-destructive">
          {{ submitError }}
        </p>
      </form>

      <SheetFooter>
        <Button type="button" variant="outline" @click="emit('close')">
          Cancel
        </Button>
        <Button :disabled="!valid || submitting" @click="onSubmit">
          {{ submitting ? 'Importing…' : 'Import & connect' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
