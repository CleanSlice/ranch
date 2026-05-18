<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { IAgentChannel } from '#agentChannel/stores/agentChannel';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#theme/components/ui/select';
import { Skeleton } from '#theme/components/ui/skeleton';
import {
  IconBrandTelegram,
  IconEye,
  IconEyeOff,
  IconPencil,
  IconPlus,
  IconTrash,
  IconX,
} from '@tabler/icons-vue';

const props = defineProps<{
  agentId: string;
}>();

const agentStore = useAgentStore();
const agentChannelStore = useAgentChannelStore();

// Always fresh on tab open — channels.json is also mutated by the runtime
// (channel_telegram_set tool), so a stale client view would be misleading.
// No polling: re-open the tab to see runtime-side changes.
const channels = ref<IAgentChannel[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

async function loadChannels() {
  loading.value = true;
  loadError.value = null;
  try {
    channels.value = await agentChannelStore.fetchForAgent(props.agentId);
  } catch (err) {
    loadError.value = (err as Error).message || 'Failed to load channels';
    channels.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(loadChannels);
watch(() => props.agentId, loadChannels);

// "Add channel" picker — currently only Telegram. Adding Slack/Discord later
// is a matter of adding entries here + a matching form below.
type ChannelType = 'telegram';
const CHANNEL_OPTIONS: { value: ChannelType; label: string }[] = [
  { value: 'telegram', label: 'Telegram' },
];

const formOpen = ref(false);
const editingIndex = ref<number | null>(null);
const formType = ref<ChannelType>('telegram');
const formBotToken = ref('');
const formBotName = ref('');
const formAdminIds = ref('');
const submitting = ref(false);
const saveError = ref<string | null>(null);
const revealedTokens = ref<Set<number>>(new Set());

const existingTypes = computed(
  () => new Set(channels.value.map((c) => c.type)),
);
const availableTypes = computed(() =>
  CHANNEL_OPTIONS.filter(
    (o) => editingIndex.value !== null || !existingTypes.value.has(o.value),
  ),
);

function openAddForm() {
  if (availableTypes.value.length === 0) return;
  editingIndex.value = null;
  formType.value = availableTypes.value[0].value;
  formBotToken.value = '';
  formBotName.value = '';
  formAdminIds.value = '';
  saveError.value = null;
  formOpen.value = true;
}

function openEditForm(index: number) {
  const ch = channels.value[index];
  if (!ch) return;
  editingIndex.value = index;
  formType.value = ch.type;
  formBotToken.value = ch.config.botToken;
  formBotName.value = ch.config.botName ?? '';
  formAdminIds.value = ch.config.adminIds ?? '';
  saveError.value = null;
  formOpen.value = true;
}

function closeForm() {
  formOpen.value = false;
  editingIndex.value = null;
  saveError.value = null;
}

function buildChannel(): IAgentChannel | null {
  if (formType.value === 'telegram') {
    if (!formBotToken.value.trim()) return null;
    return {
      type: 'telegram',
      config: {
        botToken: formBotToken.value.trim(),
        botName: formBotName.value.trim() || undefined,
        adminIds: formAdminIds.value.trim() || undefined,
      },
    };
  }
  return null;
}

async function persist(next: IAgentChannel[]): Promise<void> {
  submitting.value = true;
  saveError.value = null;
  try {
    channels.value = await agentChannelStore.setForAgent(props.agentId, next);
    agentStore.markPendingRestart(props.agentId);
    closeForm();
  } catch (err) {
    saveError.value = (err as Error).message || 'Save failed';
  } finally {
    submitting.value = false;
  }
}

async function onSave() {
  const ch = buildChannel();
  if (!ch) {
    saveError.value = 'Bot token is required.';
    return;
  }
  const next = [...channels.value];
  if (editingIndex.value !== null) {
    next[editingIndex.value] = ch;
  } else {
    next.push(ch);
  }
  await persist(next);
}

async function onRemove(index: number) {
  const ch = channels.value[index];
  if (!ch) return;
  if (!window.confirm(`Remove ${ch.type} channel from this agent?`)) return;
  const next = channels.value.filter((_, i) => i !== index);
  await persist(next);
}

function toggleReveal(index: number) {
  const set = new Set(revealedTokens.value);
  if (set.has(index)) set.delete(index);
  else set.add(index);
  revealedTokens.value = set;
}

function mask(v: string) {
  if (!v) return '';
  if (v.length <= 8) return '•'.repeat(v.length);
  return `${v.slice(0, 4)}${'•'.repeat(Math.max(8, v.length - 8))}${v.slice(-4)}`;
}

const typeLabel = (t: ChannelType) =>
  CHANNEL_OPTIONS.find((o) => o.value === t)?.label ?? t;

watch(channels, () => {
  // Drop stale reveal flags after the channel set shifts (delete shrinks
  // the array → previously-revealed indexes now point at different rows).
  revealedTokens.value = new Set();
});
</script>

<template>
  <Card>
    <CardHeader class="flex flex-row items-start justify-between gap-2 space-y-0">
      <div>
        <CardTitle>Channels</CardTitle>
        <CardDescription>
          Messaging platforms this agent talks on. Stored as
          <code>data/channels.json</code> in S3 — also mutable by the runtime
          via its channel_* tools. Restart the agent to apply changes (token
          env vars are injected at pod submit time).
        </CardDescription>
      </div>
      <Button
        v-if="availableTypes.length > 0 && !formOpen && !loading"
        size="sm"
        @click="openAddForm"
      >
        <IconPlus class="size-4" />
        Add channel
      </Button>
    </CardHeader>

    <CardContent class="flex flex-col gap-3">
      <div v-if="loading" class="flex flex-col gap-2">
        <Skeleton class="h-16 w-full" />
        <Skeleton class="h-16 w-full" />
      </div>

      <div
        v-else-if="loadError"
        class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
      >
        {{ loadError }}
      </div>

      <template v-else>
        <div
          v-if="channels.length === 0 && !formOpen"
          class="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground"
        >
          No channels configured. Add Telegram to let users message this agent
          via @BotFather.
        </div>

        <div
          v-for="(channel, index) in channels"
          :key="`${channel.type}-${index}`"
          class="flex flex-col gap-2 rounded-md border bg-muted/20 p-3"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <IconBrandTelegram
                v-if="channel.type === 'telegram'"
                class="size-4 text-primary"
              />
              <span class="font-medium">{{ typeLabel(channel.type) }}</span>
              <span
                v-if="channel.type === 'telegram' && channel.config.botName"
                class="text-xs text-muted-foreground"
              >
                @{{ channel.config.botName }}
              </span>
            </div>
            <div class="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                class="h-7 px-2"
                :disabled="formOpen"
                @click="openEditForm(index)"
              >
                <IconPencil class="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 px-2 text-destructive hover:text-destructive"
                :disabled="formOpen || submitting"
                @click="onRemove(index)"
              >
                <IconTrash class="size-3.5" />
              </Button>
            </div>
          </div>

          <dl class="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs">
            <dt class="text-muted-foreground">Bot token</dt>
            <dd class="font-mono break-all">
              {{
                revealedTokens.has(index)
                  ? channel.config.botToken
                  : mask(channel.config.botToken)
              }}
            </dd>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground"
              @click="toggleReveal(index)"
            >
              <IconEyeOff
                v-if="revealedTokens.has(index)"
                class="size-3.5"
              />
              <IconEye v-else class="size-3.5" />
            </button>
            <template v-if="channel.config.adminIds">
              <dt class="text-muted-foreground">Admin IDs</dt>
              <dd class="font-mono break-all">{{ channel.config.adminIds }}</dd>
              <dd />
            </template>
          </dl>
        </div>

        <div v-if="formOpen" class="flex flex-col gap-3 rounded-md border p-3">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold">
              {{ editingIndex !== null ? 'Edit channel' : 'Add channel' }}
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
            <Label class="text-xs">Type</Label>
            <Select
              v-model="formType"
              :disabled="editingIndex !== null || submitting"
            >
              <SelectTrigger class="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="opt in availableTypes"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <template v-if="formType === 'telegram'">
            <div class="flex flex-col gap-1.5">
              <Label for="telegram-token" class="text-xs">
                Bot token
                <span class="text-muted-foreground">(from @BotFather)</span>
              </Label>
              <Input
                id="telegram-token"
                v-model="formBotToken"
                type="password"
                placeholder="123456:ABC-DEF..."
                :disabled="submitting"
                class="font-mono text-xs"
              />
            </div>

            <div class="flex flex-col gap-1.5">
              <Label for="telegram-name" class="text-xs">
                Bot name <span class="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="telegram-name"
                v-model="formBotName"
                placeholder="mycoolbot"
                :disabled="submitting"
              />
            </div>

            <div class="flex flex-col gap-1.5">
              <Label for="telegram-admins" class="text-xs">
                Admin chat IDs
                <span class="text-muted-foreground">(comma-separated, optional)</span>
              </Label>
              <Input
                id="telegram-admins"
                v-model="formAdminIds"
                placeholder="123456789,987654321"
                :disabled="submitting"
                class="font-mono text-xs"
              />
            </div>
          </template>

          <p v-if="saveError" class="text-xs text-destructive">{{ saveError }}</p>

          <div class="flex justify-end gap-2">
            <Button
              variant="outline"
              :disabled="submitting"
              @click="closeForm"
            >
              Cancel
            </Button>
            <Button :disabled="submitting" @click="onSave">
              {{
                submitting ? 'Saving…' : editingIndex !== null ? 'Save' : 'Add'
              }}
            </Button>
          </div>
        </div>
      </template>
    </CardContent>
  </Card>
</template>
