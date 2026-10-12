<script setup lang="ts">
import { IconAlertTriangle } from '@tabler/icons-vue';
import { formatStamp } from '#common/utils/format';

/**
 * Where the team is told when an agent goes down. Not a `SettingForm`: the
 * address is not a settings row. It is a secret the API takes and never hands
 * back, so this form can show that one is set — its last four characters, who
 * set it, when — and can replace or remove it, but never display it again.
 */
const props = defineProps<{
  /** Saving, replacing and removing are the owner's; an admin reads. */
  canEdit: boolean;
}>();

const store = useAgentEventStore();
const destination = computed(() => store.destination);

const address = ref('');
const replacing = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const confirmRemoveOpen = ref(false);
const removing = ref(false);

const showField = computed(
  () => props.canEdit && (!destination.value?.configured || replacing.value),
);

async function save() {
  const value = address.value.trim();
  if (!value) return;
  saving.value = true;
  error.value = null;
  try {
    await store.saveDestination(value);
    // The address is not kept anywhere on this side once it is sent.
    address.value = '';
    replacing.value = false;
  } catch (err) {
    // The server says why it refused — "must be a Slack incoming webhook".
    error.value = (err as Error).message;
  } finally {
    saving.value = false;
  }
}

function cancelReplace() {
  replacing.value = false;
  address.value = '';
  error.value = null;
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
        One message in Slack when an agent goes down, and one when Ranch has
        seen it running again for ten quiet minutes. Events are recorded
        whether or not a destination is set.
      </CardDescription>
    </CardHeader>
    <CardContent class="grid max-w-xl gap-4">
      <div
        v-if="destination?.configured"
        class="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm"
      >
        <div>
          <div class="font-medium">
            Slack · ends in <code>{{ destination.hint }}</code>
          </div>
          <div v-if="destination.updatedAt" class="text-xs text-muted-foreground">
            Set {{ formatStamp(destination.updatedAt) }}. The address is stored
            and cannot be shown again.
          </div>
        </div>
        <div v-if="canEdit && !replacing" class="flex gap-2">
          <Button variant="outline" size="sm" @click="replacing = true">
            Replace
          </Button>
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
        No destination is set. Nobody outside this console is told when an
        agent goes down.
      </p>

      <form v-if="showField" class="grid gap-2" @submit.prevent="save">
        <Label for="notification-destination-address">
          Slack webhook address
        </Label>
        <Input
          id="notification-destination-address"
          v-model="address"
          type="password"
          autocomplete="off"
          placeholder="https://hooks.slack.com/services/…"
        />
        <p class="text-xs text-muted-foreground">
          In Slack: create an app from scratch, turn on
          <span class="font-medium">Incoming Webhooks</span>, add a webhook to
          the workspace and pick the channel.
          <a
            class="underline"
            href="https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/"
            target="_blank"
            rel="noopener"
            >Slack’s guide</a
          >. Only a Slack incoming webhook is accepted.
        </p>
        <div class="flex gap-2">
          <Button type="submit" :disabled="saving || !address.trim()">
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

      <p
        v-if="error"
        class="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
      >
        {{ error }}
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
      description="Nobody outside this console will be told when an agent goes down. Events keep being recorded. The address cannot be recovered — you would paste it in again."
      confirm-label="Remove destination"
      :busy="removing"
      @confirm="remove"
    />
  </Card>
</template>
