<script setup lang="ts">
// The page says which language it is in, and keeps saying so after a switch:
// screen readers pick their voice from it, and a browser decides from it
// whether to offer a translation.
const { locale } = useI18n();
useHead({ htmlAttrs: { lang: locale } });
</script>

<template>
  <!-- Route changes show a bar in the console's two colours, lavender to
       copper (CLEAN-249). -->
  <NuxtLoadingIndicator
    color="linear-gradient(90deg, #c9a1e4, #f5a16b)"
    :height="2"
  />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
