<script setup lang="ts">
import type { IMcpServerData, ICreateMcpServerData, McpServerAuthTypes, McpServerTransportTypes } from '#mcpServer/stores/mcpServer';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import { Checkbox } from '#theme/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#theme/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';

const props = defineProps<{
  initialValues?: IMcpServerData;
  submitting?: boolean;
  submitLabel?: string;
}>();

const emit = defineEmits<{
  submit: [values: ICreateMcpServerData];
  cancel: [];
}>();

const isEdit = computed(() => !!props.initialValues);
const isBuiltIn = computed(() => props.initialValues?.builtIn ?? false);

const form = reactive<{
  name: string;
  description: string;
  url: string;
  transport: McpServerTransportTypes;
  authType: McpServerAuthTypes;
  authValue: string;
  enabled: boolean;
}>({
  name: props.initialValues?.name ?? '',
  description: props.initialValues?.description ?? '',
  url: props.initialValues?.url ?? '',
  transport: props.initialValues?.transport ?? 'streamableHttp',
  authType: props.initialValues?.authType ?? 'none',
  authValue: props.initialValues?.authValue ?? '',
  enabled: props.initialValues?.enabled ?? true,
});

const errors = reactive<Partial<Record<'name' | 'url', string>>>({});

function validate(): boolean {
  errors.name = form.name.trim() ? undefined : 'Name is required';
  errors.url = form.url.trim() ? undefined : 'URL is required';
  return !errors.name && !errors.url;
}

function onSubmit() {
  if (!validate()) return;
  emit('submit', {
    name: form.name.trim(),
    description: form.description.trim() || null,
    url: form.url.trim(),
    transport: form.transport,
    authType: form.authType,
    authValue: form.authType === 'none' ? null : (form.authValue.trim() || null),
    enabled: form.enabled,
  });
}
</script>

<template>
  <form class="flex flex-col gap-6" @submit.prevent="onSubmit">
    <Card>
      <CardHeader>
        <CardTitle>Connection</CardTitle>
        <CardDescription>
          Where the runtime connects and how it authenticates. Use
          <code>${'$'}{RANCH_API_TOKEN}</code> as the auth value to substitute the agent's
          service token at runtime.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-2xl gap-4">
        <div class="grid gap-2">
          <Label for="mcp-name">Name</Label>
          <Input
            id="mcp-name"
            v-model="form.name"
            placeholder="GitHub MCP"
            :disabled="submitting || isBuiltIn"
            :aria-invalid="!!errors.name"
          />
          <p v-if="isBuiltIn" class="text-xs text-muted-foreground">
            Built-in entry — name is locked.
          </p>
          <p v-if="errors.name" class="text-xs text-destructive">{{ errors.name }}</p>
        </div>

        <div class="grid gap-2">
          <Label for="mcp-description">Description</Label>
          <Input
            id="mcp-description"
            v-model="form.description"
            placeholder="What this server provides"
            :disabled="submitting"
          />
        </div>

        <div class="grid gap-2">
          <Label for="mcp-url">URL</Label>
          <Input
            id="mcp-url"
            v-model="form.url"
            placeholder="https://example.com/mcp"
            :disabled="submitting || isBuiltIn"
            :aria-invalid="!!errors.url"
          />
          <p v-if="isBuiltIn" class="text-xs text-muted-foreground">
            Built-in entry — URL is locked (managed by the API itself).
          </p>
          <p v-if="errors.url" class="text-xs text-destructive">{{ errors.url }}</p>
        </div>

        <div class="grid gap-2">
          <Label for="mcp-transport">Transport</Label>
          <Select v-model="form.transport" :disabled="submitting || isBuiltIn">
            <SelectTrigger id="mcp-transport">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="streamableHttp">Streamable HTTP (preferred)</SelectItem>
              <SelectItem value="sse">SSE (legacy)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Auth</CardTitle>
        <CardDescription>
          How the runtime authenticates. Bearer puts the value in the
          <code>Authorization</code> header.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-2xl gap-4">
        <div class="grid gap-2">
          <Label for="mcp-authType">Auth type</Label>
          <Select v-model="form.authType" :disabled="submitting || isBuiltIn">
            <SelectTrigger id="mcp-authType">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="bearer">Bearer token</SelectItem>
              <SelectItem value="header">Custom header</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div v-if="form.authType !== 'none'" class="grid gap-2">
          <Label for="mcp-authValue">
            {{ form.authType === 'bearer' ? 'Token' : 'Header (JSON: { "X-Foo": "value" })' }}
          </Label>
          <Input
            id="mcp-authValue"
            v-model="form.authValue"
            :placeholder="form.authType === 'bearer' ? '${RANCH_API_TOKEN}  or  ghp_...' : '{ \&quot;X-Token\&quot;: \&quot;...\&quot; }'"
            type="password"
            autocomplete="off"
            :disabled="submitting || isBuiltIn"
          />
          <p class="text-xs text-muted-foreground">
            Use <code>${'$'}{RANCH_API_TOKEN}</code> to inject the agent's service token at runtime.
          </p>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Enabled</CardTitle>
        <CardDescription>
          When off, agents skip this server even if their template attaches it.
          Useful to globally pause a flaky MCP without detaching everywhere.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-2xl gap-2">
        <label for="mcp-enabled" class="flex items-start gap-3 text-sm">
          <Checkbox
            id="mcp-enabled"
            :model-value="form.enabled"
            :disabled="submitting"
            @update:model-value="(v: boolean | 'indeterminate') => (form.enabled = v === true)"
          />
          <span>
            <span class="font-medium">Enabled</span>
            <span class="block text-xs text-muted-foreground">
              Built-in servers respect this flag too — disable to globally turn off the Ranch MCP.
            </span>
          </span>
        </label>
      </CardContent>
    </Card>

    <div class="flex items-center gap-3">
      <Button type="submit" :disabled="submitting">
        {{ submitting ? 'Saving…' : (submitLabel ?? (isEdit ? 'Save changes' : 'Create MCP server')) }}
      </Button>
      <Button type="button" variant="ghost" @click="emit('cancel')">Cancel</Button>
    </div>
  </form>
</template>
