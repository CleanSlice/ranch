<script setup lang="ts">
import type { ILlmCredentialData } from '#llm/stores/llm';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import { Badge } from '#theme/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#theme/components/ui/table';

const llmStore = useLlmStore();

await useAsyncData('admin-llms', () => llmStore.fetchAll());

interface IDraft {
  provider: string;
  model: string;
  label: string;
  apiKey: string;
  status: string;
}

function emptyDraft(): IDraft {
  return {
    provider: 'anthropic',
    model: '',
    label: '',
    apiKey: '',
    status: 'active',
  };
}

const editingId = ref<string | null>(null);
const draft = reactive<IDraft>(emptyDraft());
const saving = ref(false);
const errorMessage = ref<string | null>(null);

function resetDraft() {
  Object.assign(draft, emptyDraft());
  editingId.value = null;
  errorMessage.value = null;
}

function startEdit(item: ILlmCredentialData) {
  editingId.value = item.id;
  draft.provider = item.provider;
  draft.model = item.model;
  draft.label = item.label ?? '';
  draft.apiKey = item.apiKey;
  draft.status = item.status;
  errorMessage.value = null;
}

async function onSave() {
  saving.value = true;
  errorMessage.value = null;
  try {
    const body = {
      provider: draft.provider.trim(),
      model: draft.model.trim(),
      apiKey: draft.apiKey.trim(),
      label: draft.label.trim() || undefined,
      status: draft.status,
    };
    if (!body.provider || !body.model || !body.apiKey) {
      errorMessage.value = 'provider, model and api key are required';
      return;
    }
    if (editingId.value) {
      await llmStore.update(editingId.value, body);
    } else {
      await llmStore.create(body);
    }
    resetDraft();
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    saving.value = false;
  }
}

async function onRemove(item: ILlmCredentialData) {
  if (!confirm('Delete this credential?')) return;
  await llmStore.remove(item.id);
  if (editingId.value === item.id) resetDraft();
}

function mask(key: string) {
  if (!key) return '';
  if (key.length <= 8) return '•'.repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-semibold">LLMs</h1>
      <p class="text-sm text-muted-foreground">
        Credentials the runtime can inject into agent pods. Each entry becomes an
        env var on the pod (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY); the agent
        picks which to use based on its own config.
      </p>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>{{ editingId ? 'Edit credential' : 'Add credential' }}</CardTitle>
        <CardDescription>API key stored plaintext for now.</CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-3xl gap-4 md:grid-cols-2">
        <div class="grid gap-2">
          <Label for="llm-provider">Provider</Label>
          <Input
            id="llm-provider"
            v-model="draft.provider"
            placeholder="anthropic"
          />
        </div>
        <div class="grid gap-2">
          <Label for="llm-model">Model</Label>
          <Input
            id="llm-model"
            v-model="draft.model"
            placeholder="claude-sonnet-4-6"
          />
        </div>
        <div class="grid gap-2">
          <Label for="llm-label">Label (optional)</Label>
          <Input
            id="llm-label"
            v-model="draft.label"
            placeholder="primary"
          />
        </div>
        <div class="grid gap-2">
          <Label for="llm-status">Status</Label>
          <select
            id="llm-status"
            v-model="draft.status"
            class="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        </div>
        <div class="grid gap-2 md:col-span-2">
          <Label for="llm-apikey">API key</Label>
          <Input
            id="llm-apikey"
            v-model="draft.apiKey"
            type="password"
            autocomplete="off"
            placeholder="sk-ant-… / sk-…"
          />
        </div>
        <div class="flex items-center gap-3 md:col-span-2">
          <Button :disabled="saving" @click="onSave">
            {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Add credential' }}
          </Button>
          <Button v-if="editingId" variant="ghost" :disabled="saving" @click="resetDraft">
            Cancel
          </Button>
          <span v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</span>
        </div>
      </CardContent>
    </Card>

    <div v-if="llmStore.loading" class="text-sm text-muted-foreground">Loading…</div>

    <div v-else-if="llmStore.items.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Provider</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>API key</TableHead>
            <TableHead>Status</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="item in llmStore.items" :key="item.id">
            <TableCell class="font-medium">{{ item.provider }}</TableCell>
            <TableCell>
              <code class="text-xs">{{ item.model }}</code>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ item.label ?? '—' }}</TableCell>
            <TableCell>
              <code class="text-xs text-muted-foreground">{{ mask(item.apiKey) }}</code>
            </TableCell>
            <TableCell>
              <Badge :variant="item.status === 'active' ? 'default' : 'outline'">
                {{ item.status }}
              </Badge>
            </TableCell>
            <TableCell>
              <div class="flex justify-end gap-2">
                <Button size="sm" variant="outline" @click="startEdit(item)">Edit</Button>
                <Button size="sm" variant="ghost" class="text-destructive" @click="onRemove(item)">
                  Delete
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      No LLM credentials yet. Add one above.
    </div>
  </div>
</template>
