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
const failed = ref(false);

async function onSubmit(values: { email: string; password: string }) {
  submitting.value = true;
  errorMessage.value = null;
  failed.value = false;
  try {
    await authStore.login(values.email, values.password);
    const target =
      typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
        ? route.query.redirect
        : '/agents';
    await navigateTo(target);
  } catch (err: unknown) {
    const e = err as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    failed.value = true;
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? null;
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
    :failed="failed"
    :registration-enabled="registrationEnabled"
    @submit="onSubmit"
  />
</template>
