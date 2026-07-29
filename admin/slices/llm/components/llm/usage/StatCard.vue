<script setup lang="ts">
defineProps<{
  title: string;
  value: string;
  sub?: string;
}>();
</script>

<template>
  <Card>
    <CardHeader class="pb-2">
      <CardTitle class="text-sm font-medium text-muted-foreground">
        {{ title }}
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div class="text-2xl font-semibold">{{ value }}</div>
      <div v-if="sub" class="text-xs text-muted-foreground">{{ sub }}</div>
    </CardContent>
  </Card>
</template>
