<script setup lang="ts">
import type { IAgentLaunch } from '#agent/composables/useAgentLaunch';
import type { LaunchStep } from '#agent/utils/launchSteps';

/**
 * An agent's launch as a list of steps (CLEAN-247), inside the overlay the
 * chat already raises while the agent starts. The list itself is Inspira UI's
 * Multi Step Loader, driven through its own `async` mode: a step waits until
 * a reported fact proves it, so nothing here advances on a timer.
 */
const props = defineProps<{
  launch: IAgentLaunch;
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

const view = computed(() => props.launch.view);
const failed = computed(() => view.value.outcome === 'failed');

// Copy decided in script travels as a key (docs/i18n.md).
const headingKey = computed(() =>
  failed.value ? 'launch.heading_failed' : `launch.heading_${view.value.kind}`,
);

const textKey = (step: LaunchStep) =>
  `launch.step_${step.id}_${step.state === 'done' ? 'done' : 'doing'}`;

const steps = computed(() =>
  view.value.steps.map((step) => ({
    id: step.id,
    textKey: textKey(step),
    // The loader waits on a step for as long as it is `async`.
    async: step.state !== 'done',
    duration: CATCH_UP_MS,
    failed: step.state === 'failed',
    // The server's own words: shown as received, never translated.
    reason: step.reason,
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
    <h3 class="text-sm font-semibold">{{ $t(headingKey) }}</h3>
    <div class="relative h-64 w-full">
      <MultiStepLoader
        contained
        prevent-close
        :loading="loading"
        :steps="
          steps.map((step) => ({
            id: step.id,
            text: $t(step.textKey),
            async: step.async,
            duration: step.duration,
            error: step.failed ? (step.reason ?? $t('launch.no_reason')) : undefined,
          }))
        "
        :default-duration="CATCH_UP_MS"
      />
    </div>
    <p v-if="launch.stale" class="text-xs text-muted-foreground">
      {{ $t('launch.stale') }}
    </p>
    <button
      v-if="failed && canManage"
      type="button"
      data-launch-action="retry"
      class="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
      :disabled="restarting"
      @click="emit('restart')"
    >
      <Icon
        :name="restarting ? 'loader-2' : 'refresh-cw'"
        :size="13"
        :class="restarting ? 'animate-spin' : undefined"
      />
      {{ $t(restarting ? 'chat.restarting' : 'chat.restart') }}
    </button>
  </div>
</template>
