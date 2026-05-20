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
  account: IIntegrationAccountData | null;
  catalogue: IIntegrationCatalogueItem[];
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'saved', account: IIntegrationAccountData): void;
}>();

const store = useIntegrationStore();

const open = computed(() => props.account !== null);
const value = ref('');
const submitting = ref(false);
const submitError = ref<string | null>(null);

const catalogueItem = computed(() =>
  props.catalogue.find((c) => c.service === props.account?.service),
);

watch(
  () => props.account,
  () => {
    value.value = '';
    submitError.value = null;
    submitting.value = false;
  },
);

const valid = computed(() => value.value.trim().length > 0);

function onSheetUpdate(v: boolean) {
  if (!v) emit('close');
}

async function onSubmit() {
  if (!valid.value || submitting.value || !props.account) return;
  submitting.value = true;
  submitError.value = null;
  try {
    const account = await store.saveSecret(props.account.id, value.value);
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
          {{
            account?.status === 'connected'
              ? `Rotate ${catalogueItem?.title ?? account?.service} key`
              : `Set ${catalogueItem?.title ?? account?.service} key`
          }}
        </SheetTitle>
        <SheetDescription>
          The value is written to your per-user secret vault and exposed to
          agents as
          <code class="rounded bg-muted px-1 py-0.5 text-xs">
            {{ catalogueItem?.secretEnvKey ?? '—' }}
          </code>
          at tool-call time. It is never echoed back through the API.
        </SheetDescription>
      </SheetHeader>

      <form
        class="flex flex-1 flex-col gap-5 overflow-y-auto p-4"
        @submit.prevent="onSubmit"
      >
        <div class="grid gap-2">
          <Label for="integration-secret">Secret value</Label>
          <Input
            id="integration-secret"
            v-model="value"
            type="password"
            placeholder="paste here"
            autocomplete="off"
            spellcheck="false"
          />
          <p v-if="catalogueItem?.secretHelp" class="text-xs text-muted-foreground">
            {{ catalogueItem.secretHelp }}
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
          {{ submitting ? 'Saving…' : 'Save' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
