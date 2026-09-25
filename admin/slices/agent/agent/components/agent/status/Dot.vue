<script setup lang="ts">
import type { AgentStatusTypes } from '#agent/domain';
import { TONE } from '#agent/composables/useAgentRailEntries';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#theme/components/ui/tooltip';

/**
 * The workspace header's status, folded into a dot on the avatar's corner
 * (specs/017, R7). The word, its reason and the "restarted 2 minutes ago"
 * hint live in the tooltip; the colour is the rail's, so the row on the left
 * and the open agent agree at a glance.
 *
 * `TooltipProvider` renders no element, so host classes (the absolute
 * position on the avatar) are bound to an explicit root span instead.
 */
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  status: AgentStatusTypes;
  statusReason: string | null;
  deployVerb: 'started' | 'restarted' | null;
  deployAgo: string | null;
  deployHintTitle?: string;
}>();

const tone = computed(() => TONE[props.status]);

const headline = computed(() => {
  const parts: string[] = [props.status];
  if (props.deployVerb && props.deployAgo)
    parts.push(`${props.deployVerb} ${props.deployAgo}`);
  return parts.join(' · ');
});
</script>

<template>
  <span v-bind="$attrs" class="inline-flex">
    <TooltipProvider :delay-duration="200">
      <Tooltip>
        <TooltipTrigger as-child>
          <span
            class="flex size-3.5 items-center justify-center rounded-full bg-background"
            :aria-label="headline"
            role="img"
          >
            <span class="relative flex size-2.5">
              <span
                v-if="tone.pulse"
                class="absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping"
                :class="tone.dot"
              />
              <span
                class="relative inline-flex size-2.5 rounded-full"
                :class="tone.dot"
              />
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <div class="space-y-0.5">
            <div class="font-medium capitalize">{{ headline }}</div>
            <div v-if="statusReason" class="opacity-80">{{ statusReason }}</div>
            <div v-if="deployHintTitle" class="opacity-80">
              {{ deployHintTitle }}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </span>
</template>
