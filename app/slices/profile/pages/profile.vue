<script setup lang="ts">
import { agentInitials } from '#agent/utils/agentStatus';
import { registryNumber } from '#profile/utils/registryNumber';
import {
  PERIODS,
  isCorrection,
  parseStatsView,
  statsLocation,
  type IStatsView,
} from '#profile/utils/statsView';

/**
 * The profile, "Pass" (CLEAN-217): who is signed in, what their role allows,
 * and what the installation they are looking at consists of.
 *
 * The rule of the page: only what the console already holds. A value that is
 * missing removes its row; nothing is invented and nothing is padded. That is
 * why there is no portrait, no join date, no device list and no "my agents"
 * here: the console has no such data (spec 028, FR-003 / FR-004).
 *
 * Beside the pass the page has two tabs (CLEAN-258): Statistics, the
 * person's own figures, and Account, the three cards the page had before,
 * as they were. Which tab and which period are shown is in the address, so a
 * reload, Back and a link all open the same view; the pass stays where it is
 * through every change.
 *
 * Signed-out visits never reach this component: `/profile` is in the auth
 * middleware's protected prefixes.
 */
const authStore = useAuthStore();
const user = computed(() => authStore.user);

// The name where there is one, the email where there is not.
const name = computed(() => user.value?.name?.trim() || null);
const displayName = computed(() => name.value ?? user.value?.email ?? '');
// Same rule as an agent's initials, so a person and an agent are abbreviated
// the same way everywhere in the console.
const initials = computed(() =>
  agentInitials(name.value ?? undefined, user.value?.email ?? '?'),
);

// A role the console knows is shown through its key; one it does not know is
// shown as received (the header applies the same rule).
const KNOWN_ROLES = new Set<string>(Object.values(UserRoleTypes));
const roleKey = computed(() => {
  const role = user.value?.role;
  return role && KNOWN_ROLES.has(role) ? `role.${role.toLowerCase()}` : null;
});

const registry = computed(() => registryNumber(user.value?.id));

const rawVersion = useRuntimeConfig().public.ranchVersion;
const version =
  typeof rawVersion === 'string' && rawVersion.trim() ? rawVersion.trim() : null;

// The fleet: the store's records, kept fresh by the poll the agents
// workspace uses. Capacity is requested for operators only and is null for
// everyone else and on any failure.
const fleet = useAgentFleet();
await fleet.ready;
const { agents, capacity } = fleet;
const running = computed(
  () => agents.value.filter((a) => a.status === 'running').length,
);

// ── the right column: what the address says it shows ──
const route = useRoute();
const router = useRouter();
// Where this page lives, read once: the component can outlive its route for
// a moment on the way out, and must not correct somebody else's address.
const HERE = route.path;

// There is no installation scope on this page yet: the switch arrives with
// the installation view. Until then every role is read as one that may not
// see it, an operator's included, so a saved `?scope=installation` opens the
// person's own figures and is taken out of the address.
const ROLE_WITHOUT_INSTALLATION = null;
const view = computed(() => parseStatsView(route.query, ROLE_WITHOUT_INSTALLATION));

/** A view's address, with whatever else the address carries left in place. */
function locationOf(next: IStatsView) {
  const { tab: _tab, period: _period, scope: _scope, ...others } = route.query;
  const own = statsLocation(next);
  return { path: own.path, query: { ...others, ...own.query }, hash: route.hash };
}

// An address that spells a view wrongly (an unknown value, a default written
// out, a scope that is not offered) is rewritten in place: a correction is
// not a step for Back to return to.
watch(
  () => route.query,
  (query) => {
    if (route.path !== HERE) return;
    if (isCorrection(query, view.value)) void router.replace(locationOf(view.value));
  },
  { immediate: true },
);

// A choice made by the person is a step: Back returns to the view before it.
function choose(change: Partial<IStatsView>) {
  const next = { ...view.value, ...change };
  if (next.tab === view.value.tab && next.period === view.value.period) return;
  void router.push(locationOf(next));
}

const TAB_OPTIONS = [
  { value: 'stats', labelKey: 'stats.tabs.stats', icon: 'chart-column' },
  { value: 'account', labelKey: 'profile.account', icon: 'user' },
] as const;
const PERIOD_OPTIONS = PERIODS.map((days) => ({
  value: days,
  labelKey: 'stats.period.days',
  params: { count: days },
}));

// Who sees the figures on screen (spec 038, FR-023). The Owner's line is a
// different one: their conversations are the owner channel's, which the two
// consoles share, so the figures cover both.
const audienceKey = computed(() =>
  user.value?.role?.toLowerCase() === UserRoleTypes.Owner.toLowerCase()
    ? 'stats.audience.owner'
    : 'stats.audience.only_you',
);

// While it swings, the pass reaches past its column. Nothing inside the
// page may cut it (an overflow clip on the page root sliced its left edge),
// so the sideways overflow is clipped at the viewport instead: no cut inside
// the window, no horizontal scrollbar on a phone.
useHead({ htmlAttrs: { class: 'profile-open' } });

// The same two lines the header's Log out runs.
async function onLogout() {
  authStore.logout();
  await navigateTo('/');
}
</script>

<template>
  <div
    v-if="user"
    class="profile-page mx-auto grid w-full max-w-[1180px] items-start gap-x-14 gap-y-8 pb-10 lg:grid-cols-[400px_minmax(0,1fr)]"
    data-profile
  >
    <ProfilePass
      :name="displayName"
      :initials="initials"
      :role-label="roleKey ? $t(roleKey) : user.role"
      :registry="registry"
      :status="user.status ?? ''"
    >
      <template #stub>
        <ProfileFleet
          :agents="agents.length"
          :running="running"
          :capacity="capacity"
        />
      </template>
    </ProfilePass>

    <!-- 84 px on a wide screen: level with the card, below the lanyard.
         `data-profile-stats` is what assets/stats.css is scoped to. -->
    <div class="flex min-w-0 flex-col gap-4 lg:mt-[84px]" data-profile-stats>
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
        <ProfileStatsSegmented
          variant="tabs"
          name="tab"
          id-prefix="profile-tab"
          :options="TAB_OPTIONS"
          :model-value="view.tab"
          :label="$t('stats.tabs.label')"
          @update:model-value="choose({ tab: $event })"
        />
        <ProfileStatsSegmented
          v-if="view.tab === 'stats'"
          size="sm"
          name="period"
          :options="PERIOD_OPTIONS"
          :model-value="view.period"
          :label="$t('stats.period.label')"
          @update:model-value="choose({ period: $event })"
        />
      </div>

      <p
        v-if="view.tab === 'stats'"
        class="-mt-1 text-xs text-[color:var(--stats-dim)]"
        data-stats-audience
      >
        {{ $t(audienceKey) }}
      </p>

      <div
        id="profile-tab-panel"
        role="tabpanel"
        class="min-w-0"
        :aria-labelledby="`profile-tab-${view.tab}`"
      >
        <ProfileStatsProvider
          v-if="view.tab === 'stats'"
          :period="view.period"
          :initials="initials"
        />
        <div v-else class="flex min-w-0 flex-col gap-5">
          <ProfileAccount
            :name="name"
            :email="user.email"
            :id="user.id"
            :role-label="roleKey ? $t(roleKey) : user.role"
            :version="version"
          />
          <ProfileCapabilities :role="user.role" />
          <ProfileSession @logout="onLogout" />
        </div>
      </div>
    </div>
  </div>
</template>

<style>
html.profile-open {
  overflow-x: clip;
}
</style>
