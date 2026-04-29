<script setup lang="ts">
const fields = [
  {
    group: 'integrations',
    name: 's3_bucket',
    label: 'S3 bucket',
    placeholder: 'ranch-agent-data',
  },
  {
    group: 'integrations',
    name: 's3_endpoint',
    label: 'S3 endpoint (blank for AWS)',
    placeholder: 'http://cleanslice-ranch-minio-1:9000',
  },
  {
    group: 'integrations',
    name: 'aws_region',
    label: 'AWS region',
    placeholder: 'us-east-1',
  },
  {
    group: 'integrations',
    name: 'aws_access_key_id',
    label: 'AWS access key ID',
    placeholder: 'minioadmin',
  },
  {
    group: 'integrations',
    name: 'aws_secret_access_key',
    label: 'AWS secret access key',
    type: 'password' as const,
    placeholder: 'minioadmin',
  },
];
</script>

<template>
  <SettingForm
    title="S3 persistence (MinIO / AWS S3)"
    description="If bucket is set, runtime syncs .agent/ to S3 on shutdown and restores on boot. For local MinIO use endpoint http://cleanslice-ranch-minio-1:9000 (pod DNS name) and bucket ranch-agent-data. Per-agent prefix is computed as agents/{agent-id}."
    :fields="fields"
  />
</template>
