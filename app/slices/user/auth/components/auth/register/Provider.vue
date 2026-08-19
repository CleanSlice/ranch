<script setup lang="ts">
const authStore = useAuthStore();
const { enabled, refresh, loading } = useRegistrationEnabled();

await useAsyncData('app-auth-registration-enabled', () => refresh());

const submitting = ref(false);
const errorMessage = ref<string | null>(null);
const failed = ref(false);

async function onSubmit(values: {
  name?: string;
  email: string;
  password: string;
}) {
  if (!enabled.value || !values.name) return;
  submitting.value = true;
  errorMessage.value = null;
  failed.value = false;
  try {
    await authStore.register(values.name, values.email, values.password);
    await navigateTo('/agents');
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
      <h1 class="mt-4 text-lg font-semibold">{{ $t('account.closed_title') }}</h1>
      <p class="mt-1.5 text-sm text-muted-foreground">
        {{ $t('account.closed_body') }}
      </p>
      <NuxtLink
        to="/login"
        class="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-95 transition"
      >
        {{ $t('account.closed_cta') }}
        <Icon name="arrow-right" :size="14" />
      </NuxtLink>
    </div>
  </div>

  <AuthCommonForm
    v-else
    mode="register"
    :submitting="submitting"
    :error-message="errorMessage"
    :failed="failed"
    :registration-enabled="true"
    @submit="onSubmit"
  />
</template>
