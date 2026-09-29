<script setup lang="ts">
const route = useRoute();
const authStore = useAuthStore();
const { enabled: registrationEnabled, refresh: refreshRegistration } =
  useRegistrationEnabled();

await useAsyncData('app-auth-login-registration-enabled', () =>
  refreshRegistration(),
);

const submitting = ref(false);
const errorMessage = ref<string | null>(null);
const errorKey = ref<string | null>(null);
const failed = ref(false);

async function onSubmit(values: { email: string; password: string }) {
  submitting.value = true;
  errorMessage.value = null;
  errorKey.value = null;
  failed.value = false;
  try {
    await authStore.login(values.email, values.password);
    const target =
      typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
        ? route.query.redirect
        : '/agents';
    await navigateTo(target);
  } catch (err: unknown) {
    // The gateway maps every failure to an AuthError: what the API said, as
    // received, and the key for what the console says when it said nothing.
    const e = err as { serverMessage?: string | null; messageKey?: string };
    failed.value = true;
    errorMessage.value = e?.serverMessage ?? null;
    errorKey.value = e?.messageKey ?? null;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthCommonForm
    mode="login"
    :submitting="submitting"
    :error-message="errorMessage"
    :error-key="errorKey"
    :failed="failed"
    :registration-enabled="registrationEnabled"
    @submit="onSubmit"
  />
</template>
