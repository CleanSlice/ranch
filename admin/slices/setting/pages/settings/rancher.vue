<script setup lang="ts">
const fields = [
  {
    group: 'integrations',
    name: 'ranch_api_url',
    label: 'Ranch API URL',
    placeholder: 'http://host.k3d.internal:3333',
    description:
      'Base URL of this API as seen from agent pods. The Rancher admin agent uses it to call ranch_* tools. Local k3d → http://host.k3d.internal:3333. In-cluster (k8s) → http://ranch-api.platform.svc.cluster.local.',
  },
];

// Who can use the assistant is the Owner's decision (CLEAN-240); the card is
// the Owner's, and the API refuses it to anybody else.
const authStore = useAuthStore();
const isOwner = computed(() => authStore.user?.role === 'Owner');
</script>

<template>
  <div class="flex flex-col gap-6">
    <AssistantAccessRoleCard v-if="isOwner" />
    <SettingForm
      title="Rancher"
      description="Settings for the Ranch admin agent. The API URL below is injected as RANCH_API_URL into admin-flagged pods so the agent can call ranch_* endpoints."
      :fields="fields"
    />
  </div>
</template>
