<script setup lang="ts">
import { capabilitiesFor } from '#profile/utils/capabilities';

/**
 * "What you can do": the role, spelled out (CLEAN-217). The rule lives in
 * `capabilitiesFor`; this only draws it. A locked item is never hidden: it is
 * the answer to "why can I not create an agent".
 */
const props = defineProps<{ role: string }>();

const items = computed(() => capabilitiesFor(props.role));
</script>

<template>
  <section class="profile-card" aria-labelledby="profile-can-title">
    <h2 id="profile-can-title" class="m-0 pb-2 pt-4 text-base font-semibold">
      {{ $t('profile.can') }}
    </h2>
    <ul class="m-0 list-none p-0">
      <li
        v-for="item in items"
        :key="item.key"
        class="profile-cap"
        :data-cap="item.key"
        :data-state="item.state"
      >
        <Icon
          v-if="item.state === 'yes'"
          name="check"
          :size="16"
          :stroke-width="2.2"
          class="flex-none text-[#4cc38a]"
          aria-hidden="true"
        />
        <Icon
          v-else-if="item.state === 'elsewhere'"
          name="arrow-up-right"
          :size="16"
          :stroke-width="2.2"
          class="flex-none text-[#c9a1e4]"
          aria-hidden="true"
        />
        <Icon
          v-else
          name="lock"
          :size="15"
          class="flex-none text-muted-foreground"
          aria-hidden="true"
        />

        <span class="flex flex-[1_1_240px] flex-col">
          <span :class="item.state === 'locked' && 'text-muted-foreground'">
            <!-- The icon is decoration; the state is said in words. -->
            <span class="sr-only">{{ $t(`profile.cap_state.${item.state}`) }}: </span>
            {{ $t(`profile.cap.${item.key}`) }}
          </span>
          <span v-if="item.lockKey" class="text-xs text-muted-foreground">
            {{ $t(`profile.cap_lock.${item.lockKey}`) }}
          </span>
        </span>

        <span class="font-mono text-[11.5px] text-muted-foreground">
          {{ $t(`profile.cap_roles.${item.rolesKey}`) }}
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.profile-card {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  background: rgba(22, 17, 28, 0.72);
  padding: 8px 26px 12px;
}
.profile-cap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  min-height: 46px;
  padding: 6px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
@media (max-width: 479px) {
  .profile-card {
    padding-inline: 18px;
  }
}
</style>
