<script setup lang="ts">
import type { IBrowserSessionConnectionData } from '#browser/stores/browser';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#theme/components/ui/dialog';

const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{
  (event: 'added', conn: IBrowserSessionConnectionData): void;
}>();

const store = useBrowserStore();
const accountKey = ref('');
const submitting = ref(false);
const error = ref<string | null>(null);

// Account label format: <service>:<label>. We don't enforce a fixed list of
// services so users can connect anything — the slug is used as the profile
// directory name on the pool PVC.
const valid = computed(() => /^[a-zA-Z0-9_:\-]+$/.test(accountKey.value) && accountKey.value.length > 0);

watch(open, (v) => {
  if (v) {
    accountKey.value = '';
    error.value = null;
  }
});

async function onSubmit() {
  if (!valid.value || submitting.value) return;
  submitting.value = true;
  error.value = null;
  try {
    const conn = await store.open(accountKey.value.trim());
    if (conn) emit('added', conn);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add account</DialogTitle>
        <DialogDescription>
          Reserve a browser profile for a service. Examples:
          <code class="rounded bg-muted px-1 py-0.5 text-xs">instagram:miybot</code>,
          <code class="rounded bg-muted px-1 py-0.5 text-xs">paypal:main</code>,
          <code class="rounded bg-muted px-1 py-0.5 text-xs">facebook_ads:miybot</code>.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
        <div class="flex flex-col gap-2">
          <Label for="accountKey">Account label</Label>
          <Input
            id="accountKey"
            v-model="accountKey"
            placeholder="instagram:miybot"
            autocomplete="off"
          />
          <p class="text-xs text-muted-foreground">
            Letters, digits, underscore, colon, dash only.
          </p>
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <DialogFooter>
          <Button type="button" variant="outline" @click="open = false">
            Cancel
          </Button>
          <Button type="submit" :disabled="!valid || submitting">
            {{ submitting ? 'Reserving…' : 'Add and log in' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
