<script setup lang="ts">
const initStore = useInitStore();
const authStore = useAuthStore();
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(values: { name: string; email: string; password: string }) {
  submitting.value = true;
  errorMessage.value = null;
  try {
    const result = await initStore.createOwner(values.name, values.email, values.password);
    // Auto-login: /setup/init answers like /auth/login (token + lifetime +
    // user, session cookie set), so adopt it the same way login does.
    authStore.applySession(result);
    await navigateTo('/rancher');
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? 'Setup failed';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background p-6">
    <InitForm
      :submitting="submitting"
      :error-message="errorMessage"
      @submit="onSubmit"
    />
  </div>
</template>
