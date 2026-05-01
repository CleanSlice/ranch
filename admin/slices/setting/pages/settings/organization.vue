<script setup lang="ts">
const fields = [
  {
    group: 'organization',
    name: 'name',
    label: 'Organization name',
    placeholder: 'Ranch',
  },
];
</script>

<template>
  <SettingForm
    title="Organization"
    description="Name shown across the admin UI."
    :fields="fields"
  />
</template>
