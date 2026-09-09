<script setup lang="ts">
/**
 * The session-ended dialog (CLEAN-72, research R11). Mounted once in the
 * default layout and driven entirely by `authStore.sessionEnded`: the api
 * plugin sets the flag when a refresh-and-retry could not recover a 401, and
 * a successful sign-in here clears it inside the store — so the page, the
 * conversation and the composer draft underneath survive untouched. There is
 * no dismiss control on purpose: without a token the page cannot do anything,
 * so Escape and backdrop clicks do nothing.
 */
const authStore = useAuthStore();

const submitting = ref(false);
const errorMessage = ref<string | null>(null);
const failed = ref(false);
const dialogRef = ref<HTMLElement | null>(null);

async function onSubmit(values: { email: string; password: string }) {
  submitting.value = true;
  errorMessage.value = null;
  failed.value = false;
  try {
    await authStore.login(values.email, values.password);
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

// Move focus into the dialog when it appears — straight to the password when
// the email is already known, which is the common case.
watch(
  () => authStore.sessionEnded,
  async (shown) => {
    if (!shown) return;
    errorMessage.value = null;
    failed.value = false;
    await nextTick();
    const root = dialogRef.value;
    if (!root) return;
    const target = authStore.user?.email
      ? root.querySelector<HTMLInputElement>('#auth-password')
      : root.querySelector<HTMLInputElement>('#auth-email');
    target?.focus();
  },
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="authStore.sessionEnded"
        ref="dialogRef"
        class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-session-ended-title"
        aria-describedby="auth-session-ended-body"
      >
        <div
          class="w-full max-w-sm rounded-2xl border bg-card/95 p-6 shadow-lg sm:p-8"
        >
          <div class="mb-6 flex items-start gap-3">
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400"
            >
              <Icon name="lock" :size="18" />
            </span>
            <div>
              <h2
                id="auth-session-ended-title"
                class="text-lg font-semibold tracking-tight"
              >
                {{ $t('account.session_ended_title') }}
              </h2>
              <p
                id="auth-session-ended-body"
                class="mt-1 text-sm text-muted-foreground"
              >
                {{ $t('account.session_ended_body') }}
              </p>
            </div>
          </div>

          <AuthCommonForm
            mode="login"
            hide-heading
            hide-footer
            submit-label-key="account.session_ended_submit"
            :initial-email="authStore.user?.email"
            :submitting="submitting"
            :error-message="errorMessage"
            :failed="failed"
            @submit="onSubmit"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
