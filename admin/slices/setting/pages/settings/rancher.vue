<script setup lang="ts">
const fields = [
  {
    group: 'integrations',
    name: 'ranch_api_url',
    label: 'Ranch API URL',
    placeholder: 'http://host.k3d.internal:3333',
    description:
      'Base URL of this API as seen from agent pods. The Rancher admin agent uses it to call ranch_* tools. Local k3d → http://host.k3d.internal:3333. In-cluster → http://api:3001.',
  },
];
</script>

<template>
  <SettingForm
    title="Rancher"
    description="Settings for the Ranch admin agent. The API URL below is injected as RANCH_API_URL into admin-flagged pods so the agent can call ranch_* endpoints."
    :fields="fields"
  />
</template>
