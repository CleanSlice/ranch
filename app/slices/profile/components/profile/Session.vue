<script setup lang="ts">
/**
 * The session row (CLEAN-217): this browser is signed in, and two ways on.
 * It says nothing about other devices or past sign-ins: the console has no
 * such data. Log out is the page's to carry out, the same way the header's
 * is, so the two cannot differ.
 */
defineEmits<{ logout: [] }>();
</script>

<template>
  <section class="profile-session flex flex-wrap items-center gap-x-4 gap-y-3">
    <p class="m-0 flex min-w-0 flex-[1_1_220px] items-center gap-3">
      <span class="h-2 w-2 flex-none rounded-full bg-[#2fa66b]" aria-hidden="true" />
      {{ $t('profile.session') }}
    </p>
    <div class="flex flex-wrap items-center gap-3">
      <NuxtLink
        to="/agents"
        class="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        data-to-agents
      >
        {{ $t('profile.to_agents') }}
      </NuxtLink>
      <button
        type="button"
        class="inline-flex min-h-11 items-center rounded-full border px-5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        data-logout
        @click="$emit('logout')"
      >
        {{ $t('auth.sign_out') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.profile-session {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  background: rgba(22, 17, 28, 0.72);
  padding: 14px 18px 14px 26px;
}
@media (max-width: 479px) {
  .profile-session {
    padding-inline: 18px;
  }
}
</style>
