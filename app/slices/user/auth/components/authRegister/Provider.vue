<script setup lang="ts">
const authStore = useAuthStore();
const { enabled, refresh, loading } = useRegistrationEnabled();

await useAsyncData('app-auth-registration-enabled', () => refresh());

const submitting = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(values: {
  name?: string;
  email: string;
  password: string;
}) {
  if (!enabled.value || !values.name) return;
  submitting.value = true;
  errorMessage.value = null;
  try {
    await authStore.register(values.name, values.email, values.password);
    await navigateTo('/agents');
  } catch (err: unknown) {
    const e = err as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    errorMessage.value =
      e?.response?.data?.message ?? e?.message ?? 'Registration failed';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="loading" class="flex items-center justify-center py-16">
    <Icon name="loader-2" :size="24" class="animate-spin text-muted-foreground" />
  </div>

  <div v-else-if="!enabled">
    <div
      class="rounded-lg border bg-card p-6 text-center shadow-sm"
    >
      <div
        class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Icon name="lock" :size="22" />
      </div>
      <h1 class="mt-4 text-lg font-semibold">Registration is closed</h1>
      <p class="mt-1.5 text-sm text-muted-foreground">
        The administrator has disabled self-service signup.
        Ask an admin to invite you, or sign in with an existing account.
      </p>
      <NuxtLink
        to="/login"
        class="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-95 transition"
      >
        Go to sign in
        <Icon name="arrow-right" :size="14" />
      </NuxtLink>
    </div>
  </div>

  <AuthForm
    v-else
    mode="register"
    :submitting="submitting"
    :error-message="errorMessage"
    :registration-enabled="true"
    @submit="onSubmit"
  />
</template>
