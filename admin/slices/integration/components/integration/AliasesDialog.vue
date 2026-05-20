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
import { Badge } from '#theme/components/ui/badge';
import { IconX } from '@tabler/icons-vue';
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
const aliases = ref<string[]>([]);
const input = ref('');
const submitting = ref(false);
const submitError = ref<string | null>(null);

const catalogueItem = computed(() =>
  props.catalogue.find((c) => c.service === props.account?.service),
);

watch(
  () => props.account,
  (account) => {
    aliases.value = account ? [...account.aliases] : [];
    input.value = '';
    submitError.value = null;
    submitting.value = false;
  },
  { immediate: true },
);

const ALIAS_REGEX = /^[a-zA-Z0-9_:.\-]+$/;

const inputValid = computed(() => {
  const v = input.value.trim();
  return (
    v.length > 0 &&
    v.length <= 80 &&
    ALIAS_REGEX.test(v) &&
    v !== props.account?.userId &&
    !aliases.value.includes(v)
  );
});

function addAlias() {
  const v = input.value.trim();
  if (!inputValid.value) return;
  aliases.value = [...aliases.value, v];
  input.value = '';
}

function removeAlias(alias: string) {
  aliases.value = aliases.value.filter((a) => a !== alias);
}

function onSheetUpdate(v: boolean) {
  if (!v) emit('close');
}

const dirty = computed(() => {
  if (!props.account) return false;
  const before = [...props.account.aliases].sort().join(',');
  const after = [...aliases.value].sort().join(',');
  return before !== after;
});

async function onSubmit() {
  if (!dirty.value || submitting.value || !props.account) return;
  submitting.value = true;
  submitError.value = null;
  try {
    const account = await store.updateAliases(props.account.id, aliases.value);
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
    <SheetContent side="right" class="w-full sm:max-w-xl">
      <SheetHeader>
        <SheetTitle>
          Runtime identities for {{ catalogueItem?.title ?? account?.service }}
          <span v-if="account" class="text-muted-foreground">
            — {{ account.accountKey }}
          </span>
        </SheetTitle>
        <SheetDescription>
          Make this integration visible to the runtime under additional
          identities. The admin UI authenticates as your ranch-user UUID,
          but the agent's
          <code class="rounded bg-muted px-1 py-0.5 text-xs">ctx.from</code>
          is something else — a Telegram chat ID, the literal "admin", or a
          channel-specific value. Cookies and secrets are mirrored to every
          identity on save.
        </SheetDescription>
      </SheetHeader>

      <form
        class="flex flex-1 flex-col gap-5 overflow-y-auto p-4"
        @submit.prevent="addAlias"
      >
        <div class="grid gap-2">
          <Label>Owner (canonical, cannot be removed)</Label>
          <code class="truncate rounded bg-muted px-2 py-1.5 text-xs">
            {{ account?.userId }}
          </code>
        </div>

        <div class="grid gap-2">
          <Label>Aliases</Label>
          <div
            v-if="aliases.length"
            class="flex flex-wrap gap-2 rounded-md border bg-card/50 p-2"
          >
            <Badge
              v-for="alias in aliases"
              :key="alias"
              variant="secondary"
              class="gap-1 pr-1"
            >
              <span class="font-mono text-[11px]">{{ alias }}</span>
              <button
                type="button"
                class="rounded p-0.5 hover:bg-background"
                @click="removeAlias(alias)"
                aria-label="remove"
              >
                <IconX class="size-3" />
              </button>
            </Badge>
          </div>
          <p v-else class="text-xs text-muted-foreground">
            No aliases yet — runtime sees this integration only under the
            canonical owner ID.
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="alias-input">Add an identity</Label>
          <div class="flex gap-2">
            <input
              id="alias-input"
              v-model="input"
              type="text"
              class="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="55212224 (Telegram ID), admin, …"
              autocomplete="off"
              @keydown.enter.prevent="addAlias"
            />
            <Button
              type="button"
              :disabled="!inputValid"
              @click="addAlias"
            >
              Add
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            Letters, digits, underscore, colon, dot, dash. Max 16 aliases per
            account, each ≤ 80 chars.
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
        <Button :disabled="!dirty || submitting" @click="onSubmit">
          {{
            submitting
              ? 'Saving…'
              : dirty
                ? 'Save aliases'
                : 'Nothing to save'
          }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
