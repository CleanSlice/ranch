<script setup lang="ts">
const authStore = useAuthStore();

// Page-level guard: regular User can't create agents (server returns 403,
// but we redirect to the list so the URL doesn't sit broken in the address bar).
if (!authStore.hasRole(UserRoleTypes.Owner, UserRoleTypes.Admin)) {
  await navigateTo('/agents');
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-6">Create Agent</h1>
    <!-- AgentForm will be implemented here -->
  </div>
</template>
