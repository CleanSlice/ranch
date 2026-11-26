<script setup lang="ts">
/**
 * Inspira UI's Multi Step Loader, vendored: unovue/inspira-ui,
 * app/components/inspira/ui/multi-step-loader, commit 5ea509ce (MIT).
 * Its props, events, markup and motion are upstream's. What was added, and
 * nothing else (specs/037-agent-launch-steps/research.md R2):
 *   - `contained`: fill a positioned parent instead of the viewport;
 *   - theme tokens where upstream had black, white and gray;
 *   - `Step.error`: the current step shows as failed and does not advance;
 *   - `Step.id` and the `data-step*` attributes, for the checks;
 *   - a live region and `motion-reduce` variants;
 *   - `cn` from the theme.
 * This file is byte-identical in admin and app
 * (scripts/launch-steps-twin.test.ts): edit one, copy to the other.
 */
import { cn } from "#theme/utils";
import { computed, onUnmounted, ref, watch } from "vue";

interface Step {
  id?: string; // Stable name of the step, exposed as data-step
  error?: string; // The step failed: shown under it, and it does not advance
  text: string; // Display text for the step
  afterText?: string; // Text to show after step completion
  async?: boolean; // If true, waits for external trigger to proceed
  duration?: number; // Duration in ms before proceeding (default: 2000)
  action?: () => void; // Function to execute when step is active
}
interface Props {
  steps: Step[];
  loading?: boolean;
  defaultDuration?: number;
  preventClose?: boolean;
  contained?: boolean; // Fill the positioned parent instead of the viewport
}
const props = withDefaults(defineProps<Props>(), {
  loading: false,
  defaultDuration: 1500,
  preventClose: false,
  contained: false,
});

const emit = defineEmits<{
  "state-change": [number];
  complete: [];
  close: [];
}>();

const currentState = ref(0);
const stepStartTime = ref(Date.now());
const isLastStepComplete = ref(false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentTimer: any = null;

async function executeStepAction(step: Step) {
  if (typeof step.action === "function") {
    await step.action();
  }
}

async function proceedToNextStep() {
  const currentStep = props.steps[currentState.value];
  if (!currentStep) return;

  // Execute the current step's action
  await executeStepAction(currentStep);

  if (currentState.value < props.steps.length - 1) {
    currentState.value++;
    stepStartTime.value = Date.now();
    emit("state-change", currentState.value);
    processCurrentStep();
  } else {
    isLastStepComplete.value = true;
    emit("complete");
  }
}

async function processCurrentStep() {
  if (currentTimer) {
    clearTimeout(currentTimer);
  }

  const currentStep = props.steps[currentState.value];
  if (!currentStep) return;

  const duration = currentStep.duration || props.defaultDuration;

  if (!currentStep.async) {
    currentTimer = setTimeout(() => {
      proceedToNextStep();
    }, duration);
  }
}

function close() {
  emit("close");
}

type StepState = "upcoming" | "current" | "done" | "failed";

function stepState(index: number): StepState {
  const last = index === props.steps.length - 1;
  if (index < currentState.value) return "done";
  if (index > currentState.value) return "upcoming";
  if (last && isLastStepComplete.value) return "done";
  return props.steps[index]?.error ? "failed" : "current";
}

// What a screen reader is told: the step being worked on, and why it failed.
const liveText = computed(() => {
  const step = props.steps[currentState.value];
  if (!step) return "";
  return step.error ? `${step.text}: ${step.error}` : step.text;
});

// Watch for changes in the async property
watch(
  () => props.steps[currentState.value]?.async,
  async (isAsync, oldIsAsync) => {
    // Only proceed if changing from async to non-async
    if (isAsync === false && oldIsAsync === true) {
      const currentStep = props.steps[currentState.value];
      if (!currentStep) return;

      const duration = currentStep.duration || props.defaultDuration;
      currentTimer = setTimeout(() => {
        proceedToNextStep();
      }, duration);
    }
  },
);

watch(
  () => props.loading,
  (newLoading) => {
    if (newLoading) {
      currentState.value = 0;
      stepStartTime.value = Date.now();
      isLastStepComplete.value = false;
      processCurrentStep();
    } else if (currentTimer) {
      clearTimeout(currentTimer);
    }
  },
);

onUnmounted(() => {
  if (currentTimer) {
    clearTimeout(currentTimer);
  }
});
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-300"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition-opacity duration-300"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="loading && steps.length > 0"
      :class="
        cn(
          'flex size-full items-center justify-center',
          contained
            ? 'absolute inset-0 z-0 overflow-hidden'
            : 'fixed inset-0 z-100 backdrop-blur-2xl',
        )
      "
    >
      <span
        class="sr-only"
        aria-live="polite"
      >
        {{ liveText }}
      </span>
      <!-- Closing Button -->
      <button
        v-show="!preventClose"
        class="bg-primary text-primary-foreground ring-offset-background hover:bg-primary/90 focus-visible:ring-ring absolute top-4 right-4 z-101 inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
        size="sm"
        @click="close"
      >
        <!-- x-mark-heroicons -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="size-6"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M6 18 18 6M6 6l12 12"
          />
        </svg>
      </button>
      <div :class="cn('relative', contained ? 'size-full max-w-sm px-4' : 'h-96')">
        <div
          :class="
            cn(
              'relative mx-auto flex flex-col justify-start',
              contained ? 'mt-20' : 'mt-40 max-w-xl',
            )
          "
          role="list"
        >
          <div
            v-for="(step, index) in steps"
            :key="index"
          >
            <div
              v-if="step"
              role="listitem"
              :data-step="step.id"
              :data-step-state="stepState(index)"
              :aria-current="index === currentState ? 'step' : undefined"
              :class="
                cn(
                  'mb-4 flex gap-2 text-left transition-all duration-300 ease-in-out motion-reduce:transition-none',
                  stepState(index) === 'failed' ? 'items-start' : 'items-center',
                )
              "
              :style="{
                opacity:
                  index === currentState
                    ? 1
                    : Math.max(1 - Math.abs(index - currentState) * 0.2, 0),
                transform: `translateY(${
                  index === currentState ? -(currentState * 40) : -(currentState * 40)
                }px)`,
              }"
            >
              <!-- exclamation-triangle-solid-heroicons -->
              <svg
                v-if="stepState(index) === 'failed'"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="text-destructive size-6 shrink-0"
              >
                <path
                  fill-rule="evenodd"
                  d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z"
                  clip-rule="evenodd"
                />
              </svg>
              <!--  check-circle-solid-heroicons -->
              <svg
                v-else-if="
                  index < currentState ||
                  (index === steps.length - 1 && index === currentState && isLastStepComplete)
                "
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="text-primary size-6 shrink-0"
              >
                <path
                  fill-rule="evenodd"
                  d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
                  clip-rule="evenodd"
                />
              </svg>
              <!-- arrow-path-heroicons -->
              <svg
                v-else-if="
                  index === currentState && (!isLastStepComplete || index !== steps.length - 1)
                "
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                class="text-primary size-6 shrink-0 animate-spin motion-reduce:animate-none"
              >
                <path
                  fill-rule="evenodd"
                  d="M4.755 10.059a7.5 7.5 0 0 1 12.548-3.364l1.903 1.903h-3.183a.75.75 0 1 0 0 1.5h4.992a.75.75 0 0 0 .75-.75V4.356a.75.75 0 0 0-1.5 0v3.18l-1.9-1.9A9 9 0 0 0 3.306 9.67a.75.75 0 1 0 1.45.388Zm15.408 3.352a.75.75 0 0 0-.919.53 7.5 7.5 0 0 1-12.548 3.364l-1.902-1.903h3.183a.75.75 0 0 0 0-1.5H2.984a.75.75 0 0 0-.75.75v4.992a.75.75 0 0 0 1.5 0v-3.18l1.9 1.9a9 9 0 0 0 15.059-4.035.75.75 0 0 0-.53-.918Z"
                  clip-rule="evenodd"
                />
              </svg>
              <!-- check-circle-outline-heroicons -->
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="text-foreground size-6 shrink-0 opacity-50"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
              <div class="flex min-w-0 flex-col">
                <span
                  :class="
                    cn(
                      'text-foreground',
                      contained ? 'text-sm leading-6' : 'text-lg',
                      index > currentState && 'opacity-50',
                    )
                  "
                >
                  {{ step.text }}
                </span>
                <span
                  v-if="stepState(index) === 'failed'"
                  class="text-destructive mt-0.5 text-xs break-words"
                >
                  {{ step.error }}
                </span>
                <Transition
                  enter-active-class="transition-all duration-300"
                  enter-from-class="opacity-0 -translate-y-1"
                  enter-to-class="opacity-100 translate-y-0"
                >
                  <span
                    v-if="
                      step.afterText &&
                      (index < currentState ||
                        (index === steps.length - 1 &&
                          index === currentState &&
                          isLastStepComplete))
                    "
                    class="text-muted-foreground mt-1 text-sm"
                  >
                    {{ step.afterText }}
                  </span>
                </Transition>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="!contained"
        class="bg-background absolute inset-x-0 bottom-0 z-[-1] h-full bg-linear-to-t mask-[radial-gradient(900px_at_center,white_30%,transparent)]"
      />
    </div>
  </Transition>
</template>
