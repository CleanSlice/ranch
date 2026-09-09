<template>
  <LayoutProvider>
    <slot />
    <!-- Session-ended dialog (CLEAN-72): one per tab, in the signed-in layout
         only. The auth and blank layouts have no session to lose. -->
    <AuthSessionEndedProvider />
  </LayoutProvider>
</template>
