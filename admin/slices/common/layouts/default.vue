<template>
  <LayoutProvider>
    <slot />
    <!-- Mounted once for the whole console: the in-place "session ended"
         dialog, driven by the auth store. -->
    <AuthSessionEndedProvider />
  </LayoutProvider>
</template>
