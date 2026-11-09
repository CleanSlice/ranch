<script setup lang="ts">
import { agentInitials } from '#agent/utils/agentStatus';
import { registryNumber } from '#profile/utils/registryNumber';

/**
 * The profile, "Pass" (CLEAN-217): who is signed in, what their role allows,
 * and what the installation they are looking at consists of.
 *
 * The rule of the page: only what the console already holds. A value that is
 * missing removes its row; nothing is invented and nothing is padded. That is
 * why there is no portrait, no join date, no device list and no "my agents"
 * here: the console has no such data (spec 028, FR-003 / FR-004).
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

    <!-- 84 px on a wide screen: level with the card, below the lanyard. -->
    <div class="flex min-w-0 flex-col gap-5 lg:mt-[84px]">
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
</template>
