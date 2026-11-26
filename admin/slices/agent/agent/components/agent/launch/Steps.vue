<script setup lang="ts">
import type { IAgentLaunchOverlay } from '#agent/composables/useAgentLifecycle';
import type {
  LaunchKind,
  LaunchStep,
  LaunchStepId,
} from '#agent/utils/launchSteps';
import { IconLoader2, IconRefresh } from '@tabler/icons-vue';

/**
 * An agent's launch as a list of steps (CLEAN-247), inside the overlay the
 * chat already raises while the agent starts. The list itself is Inspira UI's
 * Multi Step Loader, driven through its own `async` mode: a step waits until
 * a reported fact proves it, so nothing here advances on a timer.
 */
const props = defineProps<{
  launch: IAgentLaunchOverlay;
  /** Whoever may restart this agent gets the way forward from a failure. */
  canManage: boolean;
  restarting: boolean;
}>();

const emit = defineEmits<{ restart: [] }>();

// How long a step that is already done stays "current" while the list walks
// to where the launch really is (a page opened mid-launch, or several facts
// arriving at once). Six rows at 250 ms is 1.5 s, inside the 2 s the spec
// allows for showing a change, and still long enough to see each row tick.
const CATCH_UP_MS = 250;

// One short line per step, changing with its state. English only: admin.
const WORDING: Record<LaunchStepId, { doing: string; done: string }> = {
  accepted: { doing: 'Sending request', done: 'Request accepted' },
  stopped: { doing: 'Stopping previous instance', done: 'Previous instance stopped' },
  scheduled: { doing: 'Scheduling', done: 'Scheduled' },
  container: { doing: 'Preparing container', done: 'Container ready' },
  online: { doing: 'Connecting to Ranch', done: 'Connected to Ranch' },
  ready: { doing: 'Getting ready', done: 'Ready' },
};

const HEADING: Record<LaunchKind, string> = {
  initial: 'Setting up agent',
  start: 'Starting agent',
  restart: 'Restarting agent',
};

const view = computed(() => props.launch.view);
const failed = computed(() => view.value.outcome === 'failed');

const heading = computed(() =>
  failed.value ? 'Agent failed to start' : HEADING[view.value.kind],
);

function text(step: LaunchStep): string {
  if (step.state === 'done') return WORDING[step.id].done;
  // What the last step is waiting for, in the tool line's own words.
  if (step.id === 'ready' && step.state === 'current' && props.launch.readyNote) {
    return props.launch.readyNote;
  }
  return WORDING[step.id].doing;
}

const steps = computed(() =>
  view.value.steps.map((step) => ({
    id: step.id,
    text: text(step),
    // The loader waits on a step for as long as it is `async`.
    async: step.state !== 'done',
    duration: CATCH_UP_MS,
    // Shown as received. A failure nobody gave a reason for still has to
    // read as one.
    error:
      step.state === 'failed'
        ? (step.reason ?? 'No reason was reported. Check the logs.')
        : undefined,
  })),
);

// The loader starts its walk when `loading` turns true, not when it is
// mounted with it, and starts over the same way: so it is raised after
// mount, and dropped and raised again for a new launch.
const loading = ref(false);
onMounted(() => {
  loading.value = true;
});
watch(
  () => props.launch.seq,
  async () => {
    loading.value = false;
    await nextTick();
    loading.value = true;
  },
);
</script>

<template>
  <div
    class="flex w-full max-w-sm flex-col items-center gap-2"
    :data-launch="view.kind"
    :data-launch-outcome="view.outcome"
    :data-launch-stale="launch.stale ? '' : undefined"
  >
    <p class="text-sm font-medium">{{ heading }}</p>
    <div class="relative h-64 w-full">
      <MultiStepLoader
        contained
        prevent-close
        :loading="loading"
        :steps="steps"
        :default-duration="CATCH_UP_MS"
      />
    </div>
    <p v-if="launch.stale" class="text-xs text-muted-foreground">
      Live updates paused. Reconnecting…
    </p>
    <Button
      v-if="failed && canManage"
      size="sm"
      data-launch-action="retry"
      :disabled="restarting"
      @click="emit('restart')"
    >
      <IconLoader2 v-if="restarting" class="size-4 animate-spin" />
      <IconRefresh v-else class="size-4" />
      {{ restarting ? 'Restarting…' : 'Restart agent' }}
    </Button>
  </div>
</template>
