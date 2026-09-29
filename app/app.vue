<script setup lang="ts">
// The page says which language it is in, and keeps saying so after a switch:
// screen readers pick their voice from it, and a browser decides from it
// whether to offer a translation.
const { locale } = useI18n();
useHead({ htmlAttrs: { lang: locale } });
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
