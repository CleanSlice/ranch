<script setup lang="ts">
const fields = [
  {
    group: 'integrations',
    name: 'secret_provider',
    label: 'Secret provider',
    placeholder: 'file or aws',
  },
  {
    group: 'integrations',
    name: 'aws_secret_prefix',
    label: 'AWS Secrets Manager prefix',
    placeholder: 'cleanslice/users',
    description:
      'No trailing "/" — runtime appends it. e.g. "ranch-dreamvention" → secret name "ranch-dreamvention/<userId>".',
  },
];
</script>

<template>
  <SettingForm
    title="Agent secret storage"
    description='Where agents persist user-scoped secrets at runtime. "file" stores them as JSON in the agent pod (dev only); "aws" stores them in AWS Secrets Manager under the configured prefix and reuses the AWS credentials above.'
    :fields="fields"
  />
</template>
