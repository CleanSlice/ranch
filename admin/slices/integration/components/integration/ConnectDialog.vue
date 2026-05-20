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
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import type {
  IIntegrationAccountData,
  IIntegrationCatalogueItem,
} from '#integration/stores/integration';

const props = defineProps<{
  item: IIntegrationCatalogueItem | null;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (
    event: 'connected',
    payload: {
      account: IIntegrationAccountData;
      flow: 'vnc' | 'cookies' | 'auto';
    },
  ): void;
}>();

const store = useIntegrationStore();

const open = computed(() => props.item !== null);
const accountKey = ref('');
const label = ref('');
const aliasesInput = ref('');
const submitting = ref(false);
const submitError = ref<string | null>(null);

const ALIAS_REGEX = /^[a-zA-Z0-9_:.\-]+$/;
function parseAliases(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 80 && ALIAS_REGEX.test(s));
}

// Sane defaults per mechanism — for API-style services there's typically
// only one credential, so "default" is the natural accountKey. Browser
// services need a unique handle.
watch(
  () => props.item,
  (item) => {
    accountKey.value = item?.mechanism === 'secret' ? 'default' : '';
    label.value = '';
    aliasesInput.value = '';
    submitError.value = null;
    submitting.value = false;
  },
);

const valid = computed(() => {
  if (!props.item) return false;
  return /^[a-zA-Z0-9_:.\-]+$/.test(accountKey.value) && accountKey.value.length > 0;
});

function onSheetUpdate(v: boolean) {
  if (!v) emit('close');
}

async function submitWithFlow(flow: 'vnc' | 'cookies' | 'auto') {
  if (!valid.value || submitting.value || !props.item) return;
  submitting.value = true;
  submitError.value = null;
  try {
    const aliases = parseAliases(aliasesInput.value);
    const account = await store.connect({
      service: props.item.service,
      accountKey: accountKey.value.trim(),
      label: label.value.trim() || undefined,
      aliases: aliases.length ? aliases : undefined,
    });
    if (!account) throw new Error('Empty response');
    emit('connected', { account, flow });
  } catch (err) {
    submitError.value = (err as Error).message;
  } finally {
    submitting.value = false;
  }
}

const onSubmit = () => submitWithFlow('auto');
const onSubmitCookies = () => submitWithFlow('cookies');
</script>

<template>
  <Sheet :open="open" @update:open="onSheetUpdate">
    <SheetContent side="right" class="w-full sm:max-w-xl">
      <SheetHeader>
        <SheetTitle>
          Connect {{ item?.title ?? 'service' }}
        </SheetTitle>
        <SheetDescription>
          {{ item?.description }}
        </SheetDescription>
      </SheetHeader>

      <form
        class="flex flex-1 flex-col gap-5 overflow-y-auto p-4"
        @submit.prevent="onSubmit"
      >
        <div class="grid gap-2">
          <Label for="integration-accountKey">
            {{
              item?.mechanism === 'secret'
                ? 'Account label'
                : 'Account handle'
            }}
          </Label>
          <Input
            id="integration-accountKey"
            v-model="accountKey"
            :placeholder="item?.accountKeyHint ?? 'default'"
            autocomplete="off"
          />
          <p class="text-xs text-muted-foreground">
            {{
              item?.accountKeyHint ??
              'Letters, digits, underscore, colon, dot, dash only.'
            }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="integration-label">Label (optional)</Label>
          <Input
            id="integration-label"
            v-model="label"
            placeholder="Friendly name for this account"
            autocomplete="off"
          />
        </div>

        <div class="grid gap-2">
          <Label for="integration-aliases">Runtime identities (optional)</Label>
          <Input
            id="integration-aliases"
            v-model="aliasesInput"
            placeholder="55212224, admin, …"
            autocomplete="off"
          />
          <p class="text-xs text-muted-foreground">
            Comma-separated. Telegram chat IDs / channel IDs / "admin" — any
            value an agent's <code>ctx.from</code> might be. Lets the runtime
            see these cookies/secrets under those identities. Editable later.
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
        <Button
          v-if="item?.mechanism === 'browser'"
          variant="outline"
          :disabled="!valid || submitting"
          @click="onSubmitCookies"
        >
          Import cookies instead
        </Button>
        <Button :disabled="!valid || submitting" @click="onSubmit">
          {{
            submitting
              ? 'Connecting…'
              : item?.mechanism === 'browser'
                ? 'Continue to VNC login'
                : 'Continue'
          }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
