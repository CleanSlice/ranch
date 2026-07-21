<script setup lang="ts">
import {
  IconBraces,
  IconEye,
  IconEyeOff,
  IconList,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from '@tabler/icons-vue';
import type { ISecretEntry } from '#agentSecret/stores/agentSecret';

const props = defineProps<{ id: string }>();

const store = useAgentSecretStore();

// Lazy so this sub-provider doesn't re-suspend the page once the parent's
// agent data resolves and this component mounts.
useAsyncData(
  `admin-agent-secrets-${props.id}`,
  () => store.fetchForAgent(props.id),
  { lazy: true },
);

const revealed = ref<Record<string, boolean>>({});

// Inline create/edit form state. editingName is the secret being edited, or
// null when adding a new one. The key is locked while editing — changing it
// would orphan the old key rather than rename it.
const formOpen = ref(false);
const editingName = ref<string | null>(null);
const formKey = ref('');
const formValue = ref('');
const submitting = ref(false);
const saveError = ref<string | null>(null);

function mask(v: string): string {
  if (!v) return '';
  if (v.length <= 6) return '•'.repeat(v.length);
  return `${v.slice(0, 3)}${'•'.repeat(Math.max(6, v.length - 6))}${v.slice(-3)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

async function refresh() {
  await store.fetchForAgent(props.id);
  revealed.value = {};
}

function openAddForm() {
  editingName.value = null;
  formKey.value = '';
  formValue.value = '';
  saveError.value = null;
  formOpen.value = true;
}

function openEditForm(entry: ISecretEntry) {
  editingName.value = entry.name;
  formKey.value = entry.name;
  formValue.value = entry.value;
  saveError.value = null;
  formOpen.value = true;
}

function closeForm() {
  formOpen.value = false;
  editingName.value = null;
  saveError.value = null;
}

async function onSave() {
  const key = formKey.value.trim();
  const value = formValue.value;
  if (!key) {
    saveError.value = 'Key is required.';
    return;
  }
  if (!value) {
    saveError.value = 'Value is required.';
    return;
  }
  submitting.value = true;
  saveError.value = null;
  try {
    await store.setSecret(props.id, key, value);
    revealed.value = {};
    closeForm();
  } catch (err) {
    saveError.value = (err as Error).message || 'Save failed';
  } finally {
    submitting.value = false;
  }
}

async function onDelete(entry: ISecretEntry) {
  if (!window.confirm(`Delete secret "${entry.name}"? This cannot be undone.`)) {
    return;
  }
  submitting.value = true;
  try {
    await store.deleteSecret(props.id, entry.name);
    revealed.value = {};
  } catch (err) {
    store.error = (err as Error).message || 'Delete failed';
  } finally {
    submitting.value = false;
  }
}

// ── JSON view ─────────────────────────────────────────────────────────────
// Mirrors AWS Secrets Manager's "Plaintext" tab — show & edit the whole store
// as one JSON object. Save uses the atomic replaceAll endpoint so partial
// failures aren't a thing.
type ViewMode = 'kv' | 'json';
const viewMode = ref<ViewMode>('kv');
const jsonOriginal = ref('{}');
const jsonText = ref('{}');
const jsonEditing = ref(false);
const jsonSaving = ref(false);
const jsonError = ref<string | null>(null);

function buildJson(secrets: ISecretEntry[]): string {
  const sorted = [...secrets].sort((a, b) => a.name.localeCompare(b.name));
  const obj: Record<string, string> = {};
  for (const s of sorted) obj[s.name] = s.value;
  return JSON.stringify(obj, null, 2);
}

watch(
  () => store.data?.secrets,
  (secrets) => {
    // Don't clobber in-progress edits — only refresh the textarea when the
    // user isn't actively editing.
    if (jsonEditing.value) return;
    const text = secrets ? buildJson(secrets) : '{}';
    jsonOriginal.value = text;
    jsonText.value = text;
  },
  { immediate: true },
);

function jsonEdit() {
  jsonEditing.value = true;
  jsonError.value = null;
}

function jsonCancel() {
  jsonText.value = jsonOriginal.value;
  jsonEditing.value = false;
  jsonError.value = null;
}

async function jsonSave() {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText.value);
  } catch (err) {
    jsonError.value = `Invalid JSON: ${(err as Error).message}`;
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    jsonError.value = 'JSON must be a flat object of string values.';
    return;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      jsonError.value = `Value for "${k}" must be a string (got ${typeof v}).`;
      return;
    }
    out[k] = v;
  }
  jsonSaving.value = true;
  jsonError.value = null;
  try {
    await store.replaceAllSecrets(props.id, out);
    jsonEditing.value = false;
    revealed.value = {};
  } catch (err) {
    jsonError.value = (err as Error).message || 'Save failed';
  } finally {
    jsonSaving.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-3">
        <div class="inline-flex rounded-md border bg-background p-0.5">
          <Button
            size="sm"
            :variant="viewMode === 'kv' ? 'secondary' : 'ghost'"
            class="h-7 gap-1 px-2"
            :disabled="jsonEditing"
            :title="jsonEditing ? 'Finish JSON edit first' : 'Key/value view'"
            @click="viewMode = 'kv'"
          >
            <IconList class="size-3.5" />
            <span class="text-xs">Key/value</span>
          </Button>
          <Button
            size="sm"
            :variant="viewMode === 'json' ? 'secondary' : 'ghost'"
            class="h-7 gap-1 px-2"
            :disabled="formOpen"
            :title="formOpen ? 'Close the inline form first' : 'JSON view (like AWS plaintext)'"
            @click="viewMode = 'json'"
          >
            <IconBraces class="size-3.5" />
            <span class="text-xs">JSON</span>
          </Button>
        </div>
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Provider</span>
          <Badge v-if="store.data" variant="outline" class="font-mono uppercase">
            {{ store.data.provider }}
          </Badge>
          <Badge v-else-if="store.loading" variant="outline">loading…</Badge>
          <Badge v-else variant="outline">—</Badge>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Button
          v-if="viewMode === 'kv' && !formOpen"
          size="sm"
          :disabled="store.loading"
          @click="openAddForm"
        >
          <IconPlus class="size-4" />
          Add secret
        </Button>
        <Button
          size="sm"
          variant="outline"
          :disabled="store.loading || jsonEditing"
          @click="refresh"
        >
          <IconRefresh
            class="size-4"
            :class="{ 'animate-spin': store.loading }"
          />
        </Button>
      </div>
    </div>

    <div
      v-if="store.error"
      class="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
    >
      {{ store.error }}
    </div>

    <template v-if="viewMode === 'kv'">
    <div v-if="formOpen" class="flex flex-col gap-3 rounded-md border p-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold">
          {{ editingName !== null ? 'Edit secret' : 'Add secret' }}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          class="h-7 px-2"
          :disabled="submitting"
          @click="closeForm"
        >
          <IconX class="size-3.5" />
        </Button>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label for="secret-key" class="text-xs">
          Key
          <span class="text-muted-foreground">(e.g. instagram:password)</span>
        </Label>
        <Input
          id="secret-key"
          v-model="formKey"
          placeholder="service:field"
          :disabled="submitting || editingName !== null"
          class="font-mono text-xs"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <Label for="secret-value" class="text-xs">Value</Label>
        <Input
          id="secret-value"
          v-model="formValue"
          placeholder="secret value"
          :disabled="submitting"
          class="font-mono text-xs"
        />
      </div>

      <p v-if="saveError" class="text-xs text-destructive">{{ saveError }}</p>

      <div class="flex justify-end gap-2">
        <Button variant="outline" :disabled="submitting" @click="closeForm">
          Cancel
        </Button>
        <Button :disabled="submitting" @click="onSave">
          {{ submitting ? 'Saving…' : editingName !== null ? 'Save' : 'Add' }}
        </Button>
      </div>
    </div>

    <div
      v-if="!store.loading && store.data && store.data.secrets.length === 0"
      class="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground"
    >
      No secrets stored for this agent.
    </div>

    <dl
      v-else-if="store.data && store.data.secrets.length > 0"
      class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
    >
      <template v-for="entry in store.data.secrets" :key="entry.name">
        <dt class="font-mono text-xs text-muted-foreground" :title="entry.name">
          <div class="truncate">{{ entry.name }}</div>
          <div
            v-if="entry.updatedAt"
            class="text-[10px] text-muted-foreground/70"
          >
            {{ formatDate(entry.updatedAt) }}
          </div>
        </dt>
        <dd class="min-w-0 break-all font-mono text-xs">
          <template v-if="!entry.value">
            <span class="italic text-muted-foreground">empty</span>
          </template>
          <template v-else-if="!revealed[entry.name]">
            {{ mask(entry.value) }}
          </template>
          <template v-else>
            {{ entry.value }}
          </template>
        </dd>
        <dd class="flex items-center justify-end gap-1">
          <button
            v-if="entry.value"
            type="button"
            class="text-muted-foreground hover:text-foreground"
            :title="revealed[entry.name] ? 'Hide' : 'Show'"
            @click="revealed[entry.name] = !revealed[entry.name]"
          >
            <IconEyeOff v-if="revealed[entry.name]" class="size-4" />
            <IconEye v-else class="size-4" />
          </button>
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Edit"
            :disabled="formOpen || submitting"
            @click="openEditForm(entry)"
          >
            <IconPencil class="size-4" />
          </button>
          <button
            type="button"
            class="text-muted-foreground hover:text-destructive disabled:opacity-50"
            title="Delete"
            :disabled="formOpen || submitting"
            @click="onDelete(entry)"
          >
            <IconTrash class="size-4" />
          </button>
        </dd>
      </template>
    </dl>
    </template>

    <div v-else-if="viewMode === 'json'" class="flex flex-col gap-2">
      <Textarea
        v-model="jsonText"
        :disabled="!jsonEditing || jsonSaving"
        rows="14"
        spellcheck="false"
        class="font-mono text-xs"
      />
      <p v-if="jsonError" class="text-xs text-destructive">{{ jsonError }}</p>
      <div class="flex justify-end gap-2">
        <template v-if="!jsonEditing">
          <Button
            size="sm"
            :disabled="store.loading || !store.data"
            @click="jsonEdit"
          >
            <IconPencil class="size-4" />
            Edit JSON
          </Button>
        </template>
        <template v-else>
          <Button
            size="sm"
            variant="outline"
            :disabled="jsonSaving"
            @click="jsonCancel"
          >
            Cancel
          </Button>
          <Button size="sm" :disabled="jsonSaving" @click="jsonSave">
            {{ jsonSaving ? 'Saving…' : 'Save' }}
          </Button>
        </template>
      </div>
    </div>
  </div>
</template>
