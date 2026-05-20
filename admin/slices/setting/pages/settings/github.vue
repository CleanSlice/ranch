<script setup lang="ts">
import GithubStatusCheck from '#setting/components/setting/GithubStatusCheck.vue';

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
  <div class="flex flex-col gap-6">
    <SettingForm
      title="GitHub integration"
      description="Personal Access Token used to pull private images (scopes: read:packages). Configure imagePullSecret manually in your cluster."
      :fields="fields"
    />
    <GithubStatusCheck />
  </div>
</template>
