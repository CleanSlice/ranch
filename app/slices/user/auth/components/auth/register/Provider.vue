<script setup lang="ts">
const authStore = useAuthStore();
const { enabled, refresh, loading } = useRegistrationEnabled();

await useAsyncData('app-auth-registration-enabled', () => refresh());

const submitting = ref(false);
const errorMessage = ref<string | null>(null);
const errorKey = ref<string | null>(null);
const failed = ref(false);

async function onSubmit(values: {
  name?: string;
  email: string;
  password: string;
}) {
  if (!enabled.value || !values.name) return;
  submitting.value = true;
  errorMessage.value = null;
  errorKey.value = null;
  failed.value = false;
  try {
    await authStore.register(values.name, values.email, values.password);
    await navigateTo('/agents');
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
  <div v-if="loading" class="flex items-center justify-center py-16">
    <Icon name="loader-2" :size="24" class="animate-spin text-[#8a7f94]" />
  </div>

  <div v-else-if="!enabled">
    <div class="rounded-2xl border border-[#1a1421]/10 bg-white p-6 text-center">
      <div
        class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#efeaf3] text-[#6e6478]"
      >
        <Icon name="lock" :size="22" />
      </div>
      <h1 class="mt-4 text-lg font-semibold text-[#1a1421]">{{ $t('account.closed_title') }}</h1>
      <p class="mt-1.5 text-sm text-[#6e6478]">
        {{ $t('account.closed_body') }}
      </p>
      <NuxtLink
        to="/login"
        class="mt-5 inline-flex h-11 items-center gap-1.5 rounded-full bg-[#1a1421] text-[#f8f5fa] px-5 text-sm font-semibold hover:bg-[#2a2033] transition"
      >
        {{ $t('account.closed_cta') }}
        <Icon name="arrow-right" :size="14" />
      </NuxtLink>
    </div>
  </div>

  <AuthCommonForm
    v-else
    mode="register"
    variant="gate"
    :submitting="submitting"
    :error-message="errorMessage"
    :error-key="errorKey"
    :failed="failed"
    :registration-enabled="true"
    @submit="onSubmit"
  />
</template>
