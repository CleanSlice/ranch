<script setup lang="ts">
// Local-first defaults: when nothing is saved yet, the form pre-fills with
// these so a fresh `make dev` install boots straight onto the bundled MinIO
// + bucket. The "Reset to localhost values" link below the form re-applies
// them on demand. For AWS, simply overwrite and save.
const fields = [
  {
    group: 'integrations',
    name: 's3_bucket',
    label: 'S3 bucket',
    placeholder: 'ranch-agent-data',
    default: 'ranch-agent-data',
  },
  {
    group: 'integrations',
    name: 's3_endpoint',
    label: 'S3 endpoint — API side (blank for AWS)',
    placeholder: 'http://localhost:9000',
    default: 'http://localhost:9000',
  },
  {
    group: 'integrations',
    name: 's3_endpoint_agent',
    label: 'S3 endpoint — agent pod side (blank to reuse API endpoint)',
    placeholder: 'http://cleanslice-ranch-minio-1:9000',
    default: 'http://cleanslice-ranch-minio-1:9000',
  },
  {
    group: 'integrations',
    name: 'aws_region',
    label: 'AWS region',
    placeholder: 'us-east-1',
    default: 'us-east-1',
  },
  {
    group: 'integrations',
    name: 'aws_access_key_id',
    label: 'AWS access key ID',
    placeholder: 'minioadmin',
    default: 'minioadmin',
  },
  {
    group: 'integrations',
    name: 'aws_secret_access_key',
    label: 'AWS secret access key',
    type: 'password' as const,
    placeholder: 'minioadmin',
    default: 'minioadmin',
  },
];
</script>

<template>
  <SettingForm
    title="S3 persistence (MinIO / AWS S3)"
    description="If bucket is set, runtime syncs .agent/ to S3 on shutdown and restores on boot. Two endpoints because in dev MinIO is reachable from the host as http://localhost:9000 (used by API) but from k3d pods only as http://cleanslice-ranch-minio-1:9000 (used by agents). For AWS leave both blank. Per-agent prefix is computed as agents/{agent-id}."
    :fields="fields"
  />
</template>
