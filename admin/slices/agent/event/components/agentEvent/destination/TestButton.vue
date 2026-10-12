<script setup lang="ts">
import { IconAlertCircle, IconCheck, IconSend } from '@tabler/icons-vue';
import type { ITestDelivery } from '#agentEvent/domain';
import { formatStamp } from '#common/utils/format';

/**
 * Proves the destination works: one message, labelled as a test, sent now.
 * The answer is shown here rather than in a toast — a failed test is the
 * thing the owner came to read. Modelled on the GitHub health check.
 */
defineProps<{
  canEdit: boolean;
}>();

const store = useAgentEventStore();
const destination = computed(() => store.destination);

const sending = ref(false);
const result = ref<ITestDelivery | null>(null);

async function send() {
  sending.value = true;
  result.value = null;
  try {
    result.value = await store.sendTest();
  } catch (err) {
    result.value = { delivered: false, error: (err as Error).message };
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <Card v-if="destination?.configured">
    <CardHeader>
      <CardTitle>Test</CardTitle>
      <CardDescription>
        Sends one message, clearly labelled as a test, to the destination and
        reports what it answered.
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <Button :disabled="sending || !canEdit" @click="send">
          <IconSend class="size-4" />
          {{ sending ? 'Sending…' : 'Send a test' }}
        </Button>
        <span v-if="!canEdit" class="text-xs text-muted-foreground">
          Only an owner can send a test.
        </span>
      </div>

      <div
        v-if="result?.delivered"
        class="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-400"
      >
        <IconCheck class="size-4" />
        Delivered
      </div>
      <div
        v-else-if="result"
        class="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
      >
        <div class="flex items-center gap-2 font-medium text-destructive">
          <IconAlertCircle class="size-4" />
          Not delivered
        </div>
        <!-- The destination's own answer, as received. -->
        <p v-if="result.error" class="mt-2 font-mono text-xs break-words">
          {{ result.error }}
        </p>
      </div>

      <p v-if="destination.lastDelivery" class="text-xs text-muted-foreground">
        Last delivery {{ formatStamp(destination.lastDelivery.at) }}:
        <span v-if="destination.lastDelivery.ok">delivered.</span>
        <span v-else>
          not delivered<template v-if="destination.lastDelivery.error">
            — <span class="font-mono">{{ destination.lastDelivery.error }}</span></template
          >.
        </span>
      </p>
      <p v-else class="text-xs text-muted-foreground">
        Nothing has been sent to this destination yet.
      </p>
    </CardContent>
  </Card>
</template>
