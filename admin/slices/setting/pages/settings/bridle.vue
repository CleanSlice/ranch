<script setup lang="ts">
const fields = [
  {
    group: 'integrations',
    name: 'bridle_url',
    label: 'Bridle URL',
    placeholder: 'http://host.k3d.internal:3333/ws/agent',
  },
  {
    group: 'integrations',
    name: 'bridle_api_key',
    label: 'Bridle API key',
    type: 'password' as const,
    placeholder: 'matches BRIDLE_API_KEY in api/.env',
  },
];
</script>

<template>
  <SettingForm
    title="Bridle chat hub"
    description="Agents connect to this URL on startup. Must include the /ws/agent namespace. Empty = default http://host.k3d.internal:3333/ws/agent (local k3d reaching host api)."
    :fields="fields"
  />
</template>
