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
import type { IBrowserSessionConnectionData } from '#browser/stores/browser';

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void;
  (event: 'added', conn: IBrowserSessionConnectionData): void;
}>();

const store = useBrowserStore();

const accountKey = ref('');
const submitting = ref(false);
const submitError = ref<string | null>(null);

// Account label format: <service>:<label>. We don't enforce a fixed list of
// services so users can connect anything — the slug is used as the profile
// directory name on the pool PVC.
const valid = computed(
  () => /^[a-zA-Z0-9_:\-]+$/.test(accountKey.value) && accountKey.value.length > 0,
);

function reset() {
  accountKey.value = '';
  submitError.value = null;
  submitting.value = false;
}

watch(
  () => props.open,
  (open) => {
    if (open) reset();
  },
);

async function onSubmit() {
  if (!valid.value || submitting.value) return;
  submitting.value = true;
  submitError.value = null;
  try {
    const conn = await store.open(accountKey.value.trim());
    if (!conn) throw new Error('Empty response');
    emit('added', conn);
  } catch (err) {
    submitError.value = (err as Error).message;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Sheet
    :open="open"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <SheetContent side="right" class="w-full sm:max-w-xl">
      <SheetHeader>
        <SheetTitle>Add account</SheetTitle>
        <SheetDescription>
          Reserve a browser profile for a service. Examples:
          <code class="rounded bg-muted px-1 py-0.5 text-xs">instagram:miybot</code>,
          <code class="rounded bg-muted px-1 py-0.5 text-xs">paypal:main</code>,
          <code class="rounded bg-muted px-1 py-0.5 text-xs">facebook_ads:miybot</code>.
        </SheetDescription>
      </SheetHeader>

      <form
        class="flex flex-1 flex-col gap-5 overflow-y-auto p-4"
        @submit.prevent="onSubmit"
      >
        <div class="grid gap-2">
          <Label for="browser-accountKey">Account label</Label>
          <Input
            id="browser-accountKey"
            v-model="accountKey"
            placeholder="instagram:miybot"
            autocomplete="off"
          />
          <p class="text-xs text-muted-foreground">
            Letters, digits, underscore, colon, dash only.
          </p>
        </div>

        <p v-if="submitError" class="text-xs text-destructive">
          {{ submitError }}
        </p>
      </form>

      <SheetFooter>
        <Button
          type="button"
          variant="outline"
          @click="emit('update:open', false)"
        >
          Cancel
        </Button>
        <Button :disabled="!valid || submitting" @click="onSubmit">
          {{ submitting ? 'Reserving…' : 'Add and log in' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
