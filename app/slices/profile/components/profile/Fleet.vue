<script setup lang="ts">
import { slotScale } from '#profile/utils/slotScale';

/**
 * The pass stub: the installation's fleet (CLEAN-217). Agents are the
 * installation's, never "mine": an agent has no creator field. Slots are the
 * cluster's current headroom, so the words are "slots" and "in use", never
 * "limit" or "plan".
 */
const props = defineProps<{
  agents: number;
  running: number;
  /** Null for non-operators and whenever the cluster could not be read: the
   *  third counter, the scale and its caption are then left out, not zeroed. */
  capacity: {
    freeAgentSlots: number;
    usedAgentSlots: number;
    totalAgentSlots: number;
  } | null;
}>();

const scale = computed(() => slotScale(props.capacity));
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="profile-fleet__caption flex items-baseline justify-between gap-3">
      <span>{{ $t('profile.fleet') }}</span>
      <span>{{ $t('profile.poll') }}</span>
    </div>

    <dl class="m-0 grid grid-cols-3 gap-3">
      <div class="flex flex-col gap-0.5">
        <dt class="text-[12.5px] text-muted-foreground">
          {{ $t('profile.agents', { count: agents }, agents) }}
        </dt>
        <dd class="profile-fleet__number order-first m-0" data-fleet-agents>{{ agents }}</dd>
      </div>
      <div class="flex flex-col gap-0.5">
        <dt class="text-[12.5px] text-muted-foreground">{{ $t('profile.running') }}</dt>
        <dd class="profile-fleet__number order-first m-0" data-fleet-running>{{ running }}</dd>
      </div>
      <div v-if="capacity && scale" class="flex flex-col gap-0.5">
        <dt class="text-[12.5px] text-muted-foreground">
          {{ $t('profile.slots_free', { count: capacity.freeAgentSlots }, capacity.freeAgentSlots) }}
        </dt>
        <dd class="profile-fleet__number order-first m-0" data-fleet-free>{{ capacity.freeAgentSlots }}</dd>
      </div>
    </dl>

    <div v-if="capacity && scale" class="flex flex-col gap-2">
      <div
        v-if="scale.kind === 'marks'"
        role="img"
        class="grid gap-[5px]"
        :style="{ gridTemplateColumns: `repeat(${scale.total}, minmax(0, 1fr))` }"
        :aria-label="
          $t('profile.scale_label', {
            used: scale.used,
            free: capacity.freeAgentSlots,
            total: scale.total,
          })
        "
        data-fleet-scale="marks"
      >
        <span
          v-for="i in scale.total"
          :key="i"
          class="profile-fleet__mark"
          :class="i <= scale.used ? 'profile-fleet__mark--used' : 'profile-fleet__mark--free'"
        />
      </div>
      <div
        v-else
        role="img"
        class="profile-fleet__bar"
        :aria-label="
          $t('profile.scale_label', {
            used: scale.used,
            free: capacity.freeAgentSlots,
            total: scale.total,
          })
        "
        data-fleet-scale="bar"
      >
        <span class="profile-fleet__bar-fill" :style="{ width: `${scale.ratio * 100}%` }" />
      </div>
      <p class="m-0 font-mono text-[11.5px] text-muted-foreground">
        {{ $t('profile.slots_used', { used: scale.used, total: scale.total }) }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.profile-fleet__caption {
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}
.profile-fleet__number {
  font-family: DotGothic16, 'Geist Mono', monospace;
  font-size: 34px;
  line-height: 1;
}
.profile-fleet__mark {
  height: 12px;
  border-radius: 3px;
}
.profile-fleet__mark--used {
  background: #c9a1e4;
}
.profile-fleet__mark--free {
  border: 1px dashed rgba(201, 161, 228, 0.6);
}
.profile-fleet__bar {
  height: 12px;
  overflow: hidden;
  border-radius: 3px;
  border: 1px dashed rgba(201, 161, 228, 0.6);
}
.profile-fleet__bar-fill {
  display: block;
  height: 100%;
  background: #c9a1e4;
}
</style>
