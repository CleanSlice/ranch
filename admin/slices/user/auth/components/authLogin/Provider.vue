<script setup lang="ts">
const authStore = useAuthStore();
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(values: { email: string; password: string }) {
  submitting.value = true;
  errorMessage.value = null;
  try {
    await authStore.login(values.email, values.password);
    await navigateTo('/agents');
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? 'Login failed';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background p-6">
    <AuthForm
      :submitting="submitting"
      :error-message="errorMessage"
      @submit="onSubmit"
    />
  </div>
</template>
