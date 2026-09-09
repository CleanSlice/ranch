<script setup lang="ts">
import type { ILlmCredentialData } from '#llm/stores/llm';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import { Checkbox } from '#theme/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';

const SETTING_GROUP = 'knowledge';

interface ITextField {
  name: string;
  label: string;
  type?: 'text' | 'password';
  placeholder?: string;
  description?: string;
}

const TEXT_FIELDS: ITextField[] = [
  {
    name: 'url',
    label: 'Knowledge service URL',
    placeholder: 'http://lightrag.platform.svc.cluster.local:9621',
  },
  {
    name: 'api_key',
    label: 'API key',
    type: 'password',
    placeholder: 'shared secret with the knowledge service',
  },
  {
    name: 's3_bucket',
    label: 'S3 bucket for source files',
    placeholder: 'ranch-reins-sources',
  },
];

const settingStore = useSettingStore();
const llmStore = useLlmStore();

await Promise.all([
  useAsyncData('admin-settings-knowledge', () => settingStore.fetchAll()),
  useAsyncData('admin-settings-knowledge-llms', () => llmStore.fetchAll()),
]);

function readEnabled(): boolean {
  const v = settingStore.get(SETTING_GROUP, 'enabled')?.value;
  if (typeof v === 'boolean') return v;
  return true;
}

// Both OCR settings have server-side defaults (on, 500 pages), so an unset
// row reads as the default rather than as empty.
const DEFAULT_OCR_MAX_PAGES = 500;

function readOcrEnabled(): boolean {
  const v = settingStore.get(SETTING_GROUP, 'ocr_enabled')?.value;
  if (typeof v === 'boolean') return v;
  return true;
}

function readOcrMaxPages(): number {
  const v = settingStore.get(SETTING_GROUP, 'ocr_max_pages')?.value;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_OCR_MAX_PAGES;
}

function readString(name: string): string {
  const v = settingStore.get(SETTING_GROUP, name)?.value;
  return typeof v === 'string' ? v : '';
}

const enabled = ref<boolean>(readEnabled());
const ocrEnabled = ref<boolean>(readOcrEnabled());
const ocrMaxPages = ref<number>(readOcrMaxPages());
const values = reactive<Record<string, string>>({});
for (const f of TEXT_FIELDS) {
  values[f.name] = readString(f.name);
}
const chatCredentialId = ref<string>(readString('chat_credential_id'));
const embeddingCredentialId = ref<string>(readString('embedding_credential_id'));

const chatCredentials = computed<ILlmCredentialData[]>(() =>
  llmStore.items.filter((c) => c.supportsChat && c.status === 'active'),
);
const embeddingCredentials = computed<ILlmCredentialData[]>(() =>
  llmStore.items.filter(
    (c) => c.supportsEmbedding && c.status === 'active',
  ),
);

function credentialLabel(c: ILlmCredentialData): string {
  const tag = c.label !== null && c.label.length > 0 ? ` (${c.label})` : '';
  return `${c.provider} / ${c.model}${tag}`;
}

const saving = ref(false);
const savedAt = ref<string | null>(null);
const errorMessage = ref<string | null>(null);

async function onSave(): Promise<void> {
  if (
    enabled.value &&
    (chatCredentialId.value === '' || embeddingCredentialId.value === '')
  ) {
    errorMessage.value =
      'Pick both a chat and an embedding credential before enabling the service.';
    return;
  }
  if (!Number.isInteger(ocrMaxPages.value) || ocrMaxPages.value < 1) {
    errorMessage.value = 'OCR page limit must be a whole number of at least 1.';
    return;
  }

  saving.value = true;
  errorMessage.value = null;
  try {
    const tasks: Promise<unknown>[] = [];

    const currentEnabled = settingStore.get(SETTING_GROUP, 'enabled')?.value;
    const currentEnabledBool =
      typeof currentEnabled === 'boolean' ? currentEnabled : true;
    if (enabled.value !== currentEnabledBool) {
      tasks.push(
        settingStore.upsert(SETTING_GROUP, 'enabled', enabled.value, 'json'),
      );
    }

    if (ocrEnabled.value !== readOcrEnabled()) {
      tasks.push(
        settingStore.upsert(
          SETTING_GROUP,
          'ocr_enabled',
          ocrEnabled.value,
          'json',
        ),
      );
    }
    if (ocrMaxPages.value !== readOcrMaxPages()) {
      tasks.push(
        settingStore.upsert(
          SETTING_GROUP,
          'ocr_max_pages',
          ocrMaxPages.value,
          'json',
        ),
      );
    }

    for (const f of TEXT_FIELDS) {
      const next = values[f.name] ?? '';
      const current = settingStore.get(SETTING_GROUP, f.name)?.value;
      if (next !== (typeof current === 'string' ? current : '')) {
        tasks.push(settingStore.upsert(SETTING_GROUP, f.name, next, 'string'));
      }
    }

    const currentChat = readString('chat_credential_id');
    if (chatCredentialId.value !== currentChat) {
      tasks.push(
        settingStore.upsert(
          SETTING_GROUP,
          'chat_credential_id',
          chatCredentialId.value,
          'string',
        ),
      );
    }

    const currentEmbedding = readString('embedding_credential_id');
    if (embeddingCredentialId.value !== currentEmbedding) {
      tasks.push(
        settingStore.upsert(
          SETTING_GROUP,
          'embedding_credential_id',
          embeddingCredentialId.value,
          'string',
        ),
      );
    }

    await Promise.all(tasks);
    savedAt.value = new Date().toLocaleTimeString();
  } catch (err: unknown) {
    const e = err as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    errorMessage.value =
      e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <Card>
      <CardHeader>
        <CardTitle>Knowledge service</CardTitle>
        <CardDescription>
          External RAG/knowledge service. Toggle off to disable knowledges
          across the admin and runtime even if the URL is set.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <label class="flex items-start gap-3" for="knowledge-enabled">
          <Checkbox
            id="knowledge-enabled"
            :model-value="enabled"
            @update:model-value="(v: boolean | 'indeterminate') => (enabled = v === true)"
          />
          <div class="grid gap-1">
            <Label for="knowledge-enabled" class="cursor-pointer">
              Enable knowledge service
            </Label>
            <p class="text-xs text-muted-foreground">
              When off, /knowledges API returns disabled and the admin hides
              knowledge pickers.
            </p>
            <p class="text-xs text-muted-foreground/70">knowledge/enabled</p>
          </div>
        </label>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>LLM credentials</CardTitle>
        <CardDescription>
          Pick which LLM credentials LightRAG uses. Chat handles agent
          invocations against the knowledge graph; embedding vectorizes source
          chunks. Filtered by capability flags.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div class="grid gap-2">
          <Label for="chat-credential">Chat LLM credential</Label>
          <select
            id="chat-credential"
            v-model="chatCredentialId"
            class="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">(unset)</option>
            <option
              v-for="c in chatCredentials"
              :key="c.id"
              :value="c.id"
            >
              {{ credentialLabel(c) }}
            </option>
          </select>
          <p class="text-xs text-muted-foreground">
            Used as <code>LLM_BINDING</code> / <code>LLM_MODEL</code> /
            <code>LLM_BINDING_API_KEY</code> in the LightRAG container.
          </p>
          <p class="text-xs text-muted-foreground/70">
            knowledge/chat_credential_id
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="embedding-credential">Embedding LLM credential</Label>
          <select
            id="embedding-credential"
            v-model="embeddingCredentialId"
            class="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">(unset)</option>
            <option
              v-for="c in embeddingCredentials"
              :key="c.id"
              :value="c.id"
            >
              {{ credentialLabel(c) }}
            </option>
          </select>
          <p class="text-xs text-muted-foreground">
            Used as <code>EMBEDDING_BINDING</code> /
            <code>EMBEDDING_MODEL</code> /
            <code>EMBEDDING_BINDING_API_KEY</code>.
          </p>
          <p class="text-xs text-muted-foreground/70">
            knowledge/embedding_credential_id
          </p>
        </div>

        <p
          class="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground"
        >
          After changing credentials, URL, or any LightRAG-relevant value,
          update <code>OPENAI_API_KEY</code> and the embedding/LLM model env
          vars in your <code>.env</code> (local dev) or the
          <code>lightrag-api</code> k8s secret (prod), then restart the
          LightRAG container or pod. Auto-sync of these values from the admin
          is planned for a follow-up phase.
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Scanned PDFs</CardTitle>
        <CardDescription>
          A PDF with no text layer (a scan, a photo of a form) is unreadable to
          the knowledge service. With OCR on, its text is recognised with AWS
          Textract when the file is added and that text is what gets indexed.
          The API's AWS identity needs the Textract text-detection actions.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <label class="flex items-start gap-3" for="knowledge-ocr-enabled">
          <Checkbox
            id="knowledge-ocr-enabled"
            :model-value="ocrEnabled"
            @update:model-value="(v: boolean | 'indeterminate') => (ocrEnabled = v === true)"
          />
          <div class="grid gap-1">
            <Label for="knowledge-ocr-enabled" class="cursor-pointer">
              Recognise text in scanned PDFs
            </Label>
            <p class="text-xs text-muted-foreground">
              When off, a scanned PDF is recorded as failed with the reason,
              and can be re-extracted from the sources table later.
            </p>
            <p class="text-xs text-muted-foreground/70">knowledge/ocr_enabled</p>
          </div>
        </label>
        <div class="grid gap-2">
          <Label for="knowledge-ocr-max-pages">Page limit per PDF</Label>
          <Input
            id="knowledge-ocr-max-pages"
            v-model.number="ocrMaxPages"
            type="number"
            min="1"
            step="1"
            class="w-40"
          />
          <p class="text-xs text-muted-foreground">
            Textract is billed per page; a scan longer than this is skipped
            with a reason instead of being recognised.
          </p>
          <p class="text-xs text-muted-foreground/70">
            knowledge/ocr_max_pages
          </p>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Service connection</CardTitle>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div v-for="field in TEXT_FIELDS" :key="field.name" class="grid gap-2">
          <Label :for="`knowledge-${field.name}`">{{ field.label }}</Label>
          <Input
            :id="`knowledge-${field.name}`"
            v-model="values[field.name]"
            :type="field.type ?? 'text'"
            :placeholder="field.placeholder"
            :autocomplete="field.type === 'password' ? 'new-password' : 'off'"
            spellcheck="false"
            data-1p-ignore
            data-lpignore="true"
          />
          <p v-if="field.description" class="text-xs text-muted-foreground">
            {{ field.description }}
          </p>
          <p class="text-xs text-muted-foreground/70">
            {{ SETTING_GROUP }}/{{ field.name }}
          </p>
        </div>
      </CardContent>
    </Card>

    <div class="flex items-center gap-3">
      <Button :disabled="saving" @click="onSave">
        {{ saving ? 'Saving…' : 'Save changes' }}
      </Button>
      <span v-if="savedAt" class="text-xs text-muted-foreground">
        Saved at {{ savedAt }}
      </span>
      <span v-if="errorMessage" class="text-xs text-destructive">
        {{ errorMessage }}
      </span>
    </div>
  </div>
</template>
