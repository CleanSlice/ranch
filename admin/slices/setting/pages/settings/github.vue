<script setup lang="ts">
const fields = [
  {
    group: 'integrations',
    name: 'github_username',
    label: 'GitHub username',
    placeholder: 'cleanslice',
  },
  {
    group: 'integrations',
    name: 'github_pat',
    label: 'GitHub PAT',
    type: 'password' as const,
    placeholder: 'ghp_…',
  },
];
</script>

<template>
  <SettingForm
    title="GitHub integration"
    description="Personal Access Token used to pull private images (scopes: read:packages). Configure imagePullSecret manually in your cluster."
    :fields="fields"
  />
</template>
