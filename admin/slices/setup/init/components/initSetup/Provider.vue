<script setup lang="ts">
import { handleApiAuthentication } from '#api/utils/handleApiAuthentication';

const initStore = useInitStore();
const authStore = useAuthStore();
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(values: { name: string; email: string; password: string }) {
  submitting.value = true;
  errorMessage.value = null;
  try {
    const result = await initStore.createOwner(values.name, values.email, values.password);
    // auto-login with the returned token
    handleApiAuthentication(result.accessToken);
    authStore.accessToken = result.accessToken;
    authStore.user = result.user;
    const tokenCookie = useCookie('access_token');
    tokenCookie.value = result.accessToken;
    await navigateTo('/agents');
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
