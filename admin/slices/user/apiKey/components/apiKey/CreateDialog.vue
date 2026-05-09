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
import { Checkbox } from '#theme/components/ui/checkbox';
import {
  ApiKeyScopeTypes,
  type ICreatedApiKey,
} from '#apiKey/stores/apiKey';

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void;
  (event: 'created', created: ICreatedApiKey): void;
}>();

const store = useApiKeyStore();

const name = ref('');
const scopes = ref<Set<ApiKeyScopeTypes>>(new Set([ApiKeyScopeTypes.EmbedMint]));
const expiresAt = ref('');
const submitting = ref(false);
const submitError = ref<string | null>(null);

const SCOPE_OPTIONS: Array<{ value: ApiKeyScopeTypes; label: string; description: string }> = [
  {
    value: ApiKeyScopeTypes.EmbedMint,
    label: 'embed:mint',
    description:
      'Sign short-lived browser embed JWTs via POST /auth/embed/token. Owner/Admin roles are stripped from minted tokens server-side.',
  },
  {
    value: ApiKeyScopeTypes.Admin,
    label: 'admin',
    description:
      'Full API surface (escape hatch). Equivalent to a logged-in Owner. Use with care; prefer narrower scopes.',
  },
];

function reset() {
  name.value = '';
  scopes.value = new Set([ApiKeyScopeTypes.EmbedMint]);
  expiresAt.value = '';
  submitError.value = null;
  submitting.value = false;
}

watch(
  () => props.open,
  (open) => {
    if (open) reset();
  },
);

function toggleScope(scope: ApiKeyScopeTypes, value: boolean | 'indeterminate') {
  const next = new Set(scopes.value);
  if (value === true) next.add(scope);
  else next.delete(scope);
  scopes.value = next;
}

const canSubmit = computed(
  () => name.value.trim().length >= 2 && scopes.value.size > 0 && !submitting.value,
);

async function onSubmit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  submitError.value = null;
  try {
    const created = await store.create({
      name: name.value.trim(),
      scopes: Array.from(scopes.value),
      ...(expiresAt.value ? { expiresAt: new Date(expiresAt.value).toISOString() } : {}),
    });
    if (!created) throw new Error('Empty response');
    emit('created', created);
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
        <SheetTitle>New API key</SheetTitle>
        <SheetDescription>
          Pick the narrowest scope set that does the job. The plaintext key is
          shown exactly once after creation — copy it immediately.
        </SheetDescription>
      </SheetHeader>

      <form class="flex flex-1 flex-col gap-5 overflow-y-auto p-4" @submit.prevent="onSubmit">
        <div class="grid gap-2">
          <Label for="apiKey-name">Name</Label>
          <Input
            id="apiKey-name"
            v-model="name"
            placeholder="Marketing site embed"
            autocomplete="off"
          />
          <p class="text-xs text-muted-foreground">
            Shown in the keys list. Pick something that identifies the integration.
          </p>
        </div>

        <div class="grid gap-3">
          <Label>Scopes</Label>
          <label
            v-for="opt in SCOPE_OPTIONS"
            :key="opt.value"
            class="flex items-start gap-3 rounded-md border p-3 hover:bg-muted/40"
          >
            <Checkbox
              :model-value="scopes.has(opt.value)"
              @update:model-value="(v) => toggleScope(opt.value, v)"
            />
            <div class="flex flex-col gap-1">
              <code class="text-sm font-medium">{{ opt.label }}</code>
              <p class="text-xs text-muted-foreground">{{ opt.description }}</p>
            </div>
          </label>
        </div>

        <div class="grid gap-2">
          <Label for="apiKey-expires">Expires (optional)</Label>
          <Input
            id="apiKey-expires"
            v-model="expiresAt"
            type="datetime-local"
          />
          <p class="text-xs text-muted-foreground">
            Leave blank for a non-expiring key. You can always revoke it later.
          </p>
        </div>

        <p v-if="submitError" class="text-xs text-destructive">{{ submitError }}</p>
      </form>

      <SheetFooter>
        <Button
          type="button"
          variant="outline"
          @click="emit('update:open', false)"
        >
          Cancel
        </Button>
        <Button :disabled="!canSubmit" @click="onSubmit">
          {{ submitting ? 'Creating…' : 'Create key' }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
