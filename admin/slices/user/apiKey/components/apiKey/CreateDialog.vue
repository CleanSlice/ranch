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

type ExpiryPreset = '1m' | '3m' | '6m' | 'custom' | 'never';

const EXPIRY_PRESETS: Array<{ value: ExpiryPreset; label: string }> = [
  { value: '1m', label: '1 month' },
  { value: '3m', label: '3 months' },
  { value: '6m', label: '6 months' },
  { value: 'custom', label: 'Custom' },
  { value: 'never', label: 'No expiration' },
];

const name = ref('');
const scopes = ref<Set<ApiKeyScopeTypes>>(new Set([ApiKeyScopeTypes.EmbedMint]));
const expiryPreset = ref<ExpiryPreset>('never');
const customExpiresAt = ref('');
const submitting = ref(false);
const submitError = ref<string | null>(null);

function presetToDate(preset: ExpiryPreset): Date | null {
  if (preset === 'never' || preset === 'custom') return null;
  const months = preset === '1m' ? 1 : preset === '3m' ? 3 : 6;
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d;
}

const resolvedExpiresAt = computed<Date | null>(() => {
  if (expiryPreset.value === 'custom') {
    return customExpiresAt.value ? new Date(customExpiresAt.value) : null;
  }
  return presetToDate(expiryPreset.value);
});

const resolvedExpiryLabel = computed(() => {
  const d = resolvedExpiresAt.value;
  if (!d) return null;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
});

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

const isOpen = computed({
  get: () => props.open,
  set: (v: boolean) => emit('update:open', v),
});

function reset() {
  name.value = '';
  scopes.value = new Set([ApiKeyScopeTypes.EmbedMint]);
  expiryPreset.value = 'never';
  customExpiresAt.value = '';
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

const canSubmit = computed(() => {
  if (name.value.trim().length < 2) return false;
  if (scopes.value.size === 0) return false;
  if (submitting.value) return false;
  if (expiryPreset.value === 'custom' && !customExpiresAt.value) return false;
  return true;
});

async function onSubmit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  submitError.value = null;
  try {
    const expiresAt = resolvedExpiresAt.value;
    const created = await store.create({
      name: name.value.trim(),
      scopes: Array.from(scopes.value),
      ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
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
  <DialogRoot v-model:open="isOpen">
    <DialogPortal>
      <DialogOverlay
        class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80"
      />
      <DialogContent
        class="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid max-h-[90vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border p-6 shadow-lg duration-200"
      >
        <div class="flex flex-col gap-1">
          <DialogTitle class="text-foreground text-lg font-semibold">
            New API key
          </DialogTitle>
          <DialogDescription class="text-muted-foreground text-sm">
            Pick the narrowest scope set that does the job. The plaintext key is
            shown exactly once after creation — copy it immediately.
          </DialogDescription>
        </div>

        <form class="flex flex-col gap-5" @submit.prevent="onSubmit">
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
            <Label>Expires</Label>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="opt in EXPIRY_PRESETS"
                :key="opt.value"
                type="button"
                class="rounded-md border px-3 py-1.5 text-sm transition-colors"
                :class="
                  expiryPreset === opt.value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'hover:bg-muted/40'
                "
                @click="expiryPreset = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>

            <Input
              v-if="expiryPreset === 'custom'"
              id="apiKey-expires"
              v-model="customExpiresAt"
              type="datetime-local"
              class="mt-1"
            />

            <p class="text-xs text-muted-foreground">
              <template v-if="expiryPreset === 'never'">
                Key will not expire. You can always revoke it later.
              </template>
              <template v-else-if="expiryPreset === 'custom'">
                Pick any future date. You can always revoke it later.
              </template>
              <template v-else>
                Expires on {{ resolvedExpiryLabel }}. You can always revoke it later.
              </template>
            </p>
          </div>

          <p v-if="submitError" class="text-xs text-destructive">{{ submitError }}</p>
        </form>

        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
