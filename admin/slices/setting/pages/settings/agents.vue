<script setup lang="ts">
const fields = [
  { group: 'agent_defaults', name: 'cpu', label: 'CPU', placeholder: '500m' },
  { group: 'agent_defaults', name: 'memory', label: 'Memory', placeholder: '512Mi' },
];
</script>

<template>
  <SettingForm
    title="Default agent resources"
    description="Applied when a template does not specify its own."
    :fields="fields"
  />
</template>
