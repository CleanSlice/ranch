<script setup lang="ts">
import { IconAlertTriangle } from '@tabler/icons-vue';
import type { DestinationKindTypes } from '#agentEvent/domain';
import { formatStamp } from '#common/utils/format';

/**
 * Where the team is told when an agent goes down. Not a `SettingForm`: the
 * secret — a webhook address or a bot token — is not a settings row. The API
 * takes it and never hands it back, so this form can show that one is set
 * (its last four characters, who set it, when), can replace or remove it,
 * but never display it again.
 *
 * Two kinds (CLEAN-165): the incoming webhook of CLEAN-139, and a bot that
 * keeps one message per incident with its story in the thread.
 */
const props = defineProps<{
  /** Saving, replacing and removing are the owner's; an admin reads. */
  canEdit: boolean;
}>();

const store = useAgentEventStore();
const destination = computed(() => store.destination);

const KINDS: readonly {
  key: DestinationKindTypes;
  label: string;
  detail: string;
}[] = [
  {
    key: 'webhook',
    label: 'Incoming webhook',
    detail: 'One message when an incident opens, one when it closes.',
  },
  {
    key: 'bot',
    label: 'Slack bot',
    detail:
      'One message per incident; its story in the thread; the state as a reaction. Needs a bot token and a channel.',
  },
];

// The choice starts on what is configured, or on the bot for a fresh
// install — it is the one that reads well.
const kind = ref<DestinationKindTypes>(destination.value?.kind ?? 'bot');
watch(
  () => destination.value?.kind,
  (configured) => {
    if (configured) kind.value = configured;
  },
);

const address = ref('');
const token = ref('');
const channel = ref('');
const replacing = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const confirmRemoveOpen = ref(false);
const removing = ref(false);

const showFields = computed(
  () => props.canEdit && (!destination.value?.configured || replacing.value),
);
const switching = computed(
  () =>
    destination.value?.configured === true &&
    destination.value.kind !== null &&
    destination.value.kind !== kind.value,
);
const otherKindLabel = computed(
  () => KINDS.find((k) => k.key === destination.value?.kind)?.label ?? '',
);
const canSave = computed(() =>
  kind.value === 'bot'
    ? token.value.trim() !== '' && channel.value.trim() !== ''
    : address.value.trim() !== '',
);
const configuredLabel = computed(
  () => KINDS.find((k) => k.key === destination.value?.kind)?.label ?? 'Slack',
);

function clear() {
  // Nothing of a secret is kept on this side once it is sent — or dropped.
  address.value = '';
  token.value = '';
  channel.value = '';
}

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  error.value = null;
  try {
    await store.saveDestination(
      kind.value === 'bot'
        ? {
            kind: 'bot',
            botToken: token.value.trim(),
            channelId: channel.value.trim(),
          }
        : { kind: 'webhook', webhookUrl: address.value.trim() },
    );
    clear();
    replacing.value = false;
  } catch (err) {
    // The server says why it refused — "must be a Slack incoming webhook",
    // "a bot token (xoxb-…) is needed".
    error.value = (err as Error).message;
  } finally {
    saving.value = false;
  }
}

function cancelReplace() {
  replacing.value = false;
  error.value = null;
  clear();
  if (destination.value?.kind) kind.value = destination.value.kind;
}

async function remove() {
  removing.value = true;
  error.value = null;
  try {
    await store.removeDestination();
    confirmRemoveOpen.value = false;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    removing.value = false;
  }
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Notifications</CardTitle>
      <CardDescription>
        Slack is told when an agent goes down and when Ranch has seen it running again for ten quiet
        minutes. Events are recorded whether or not a destination is set.
      </CardDescription>
    </CardHeader>
    <CardContent class="grid max-w-xl gap-4">
      <div
        v-if="destination?.configured"
        class="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm"
      >
        <div>
          <div class="font-medium">
            {{ configuredLabel }} · ends in <code>{{ destination.hint }}</code>
            <template v-if="destination.channelId">
              · channel <code>{{ destination.channelId }}</code>
            </template>
          </div>
          <div v-if="destination.updatedAt" class="text-xs text-muted-foreground">
            Set {{ formatStamp(destination.updatedAt) }}. The
            {{ destination.kind === 'bot' ? 'token' : 'address' }} is stored and cannot be shown
            again.
          </div>
        </div>
        <div v-if="canEdit && !replacing" class="flex gap-2">
          <Button variant="outline" size="sm" @click="replacing = true"> Replace </Button>
          <Button
            variant="outline"
            size="sm"
            class="text-destructive"
            @click="confirmRemoveOpen = true"
          >
            Remove
          </Button>
        </div>
      </div>
      <p v-else-if="destination" class="text-sm text-muted-foreground">
        No destination is set. Nobody outside this console is told when an agent goes down.
      </p>

      <form v-if="showFields" class="grid gap-4" @submit.prevent="save">
        <fieldset class="grid gap-2">
          <legend class="mb-1 text-sm font-medium">How Slack is told</legend>
          <RadioGroup v-model="kind" class="grid gap-2">
            <label
              v-for="option in KINDS"
              :key="option.key"
              :for="`notification-kind-${option.key}`"
              class="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 has-[[data-state=checked]]:border-primary"
            >
              <RadioGroupItem
                :id="`notification-kind-${option.key}`"
                :value="option.key"
                class="mt-0.5"
              />
              <span class="grid gap-0.5 text-sm">
                <span class="font-medium">{{ option.label }}</span>
                <span class="text-xs text-muted-foreground">{{ option.detail }}</span>
              </span>
            </label>
          </RadioGroup>
          <p v-if="switching" class="text-xs text-amber-700 dark:text-amber-400">
            Saving replaces the {{ otherKindLabel }} destination.
          </p>
        </fieldset>

        <template v-if="kind === 'webhook'">
          <div class="grid gap-2">
            <Label for="notification-destination-address"> Slack webhook address </Label>
            <Input
              id="notification-destination-address"
              v-model="address"
              type="password"
              autocomplete="off"
              placeholder="https://hooks.slack.com/services/…"
            />
            <p class="text-xs text-muted-foreground">
              In Slack: create an app from scratch, turn on
              <span class="font-medium">Incoming Webhooks</span>, add a webhook to the workspace and
              pick the channel.
              <a
                class="underline"
                href="https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/"
                target="_blank"
                rel="noopener"
                >Slack’s guide</a
              >. Only a Slack incoming webhook is accepted.
            </p>
          </div>
        </template>
        <template v-else>
          <AgentEventDestinationBotForm
            v-model:token="token"
            v-model:channel="channel"
            :current-channel="destination?.channelId"
          />
          <AgentEventDestinationBotGuide />
        </template>

        <div class="flex gap-2">
          <Button type="submit" :disabled="saving || !canSave">
            {{ saving ? 'Saving…' : 'Save' }}
          </Button>
          <Button
            v-if="replacing"
            type="button"
            variant="outline"
            :disabled="saving"
            @click="cancelReplace"
          >
            Cancel
          </Button>
        </div>
      </form>

      <p v-if="!canEdit" class="text-xs text-muted-foreground">
        Only an owner can set, replace or remove the destination.
      </p>

      <p v-if="destination" class="text-xs text-muted-foreground">
        <template v-if="destination.environment">
          Messages start with
          <code>[{{ destination.environment }}]</code> — this installation’s
          name, from <code>RANCH_ENVIRONMENT</code> on the API.
        </template>
        <template v-else>
          Messages carry no installation name. Set
          <code>RANCH_ENVIRONMENT</code> on the API (dev, staging, prod-eu)
          and they start with <code>[that name]</code>, so a reader knows
          where the agent fell.
        </template>
      </p>

      <p
        v-if="error"
        class="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
      >
        {{ error }}
      </p>

      <p
        v-if="destination && destination.apiReplicas > 1"
        class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
      >
        <IconAlertTriangle class="mt-0.5 size-4 shrink-0" />
        <span>
          The Ranch API is running as {{ destination.apiReplicas }} copies.
          Each copy sees only the agents connected to it, so "unreachable" is
          not reported while this lasts, and a chat may land on a copy
          without the agent and answer "Agent is not connected". Run
          <code>ranch-api</code> as one replica.
        </span>
      </p>

      <p
        v-if="destination?.configured && !destination.consoleLinks"
        class="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
      >
        <IconAlertTriangle class="mt-0.5 size-4 shrink-0" />
        <span>
          Messages will carry no link to this console until
          <code>ADMIN_URL</code> is set on the API.
        </span>
      </p>
    </CardContent>

    <ConfirmDialog
      v-model:open="confirmRemoveOpen"
      title="Stop sending notifications?"
      description="Nobody outside this console will be told when an agent goes down. Events keep being recorded. The secret cannot be recovered — you would paste it in again."
      confirm-label="Remove destination"
      :busy="removing"
      @confirm="remove"
    />
  </Card>
</template>
