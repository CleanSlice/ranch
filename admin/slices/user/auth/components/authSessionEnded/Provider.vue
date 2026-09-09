<script setup lang="ts">
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui';

/**
 * The in-place "session ended" dialog. Driven entirely by the auth store:
 * it opens when a refresh fails mid-use (`endSession`) and closes when a
 * login succeeds (`applySession` clears the flag). No close control, and
 * neither Escape nor an outside click dismisses it — the page underneath
 * (conversation, composer draft, scroll) is kept exactly as it was.
 */
const authStore = useAuthStore();
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(values: { email: string; password: string }) {
  submitting.value = true;
  errorMessage.value = null;
  try {
    await authStore.login(values.email, values.password);
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? 'Login failed';
  } finally {
    submitting.value = false;
  }
}

watch(
  () => authStore.sessionEnded,
  (open) => {
    if (open) errorMessage.value = null;
  },
);
</script>

<template>
  <AlertDialogRoot :open="authStore.sessionEnded">
    <AlertDialogPortal>
      <AlertDialogOverlay
        class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80"
      />
      <!-- AlertDialogContent already swallows pointer-down / interact outside;
           Escape is the one dismissal left, and it must not close this. -->
      <AlertDialogContent
        class="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg duration-200"
        @escape-key-down.prevent
      >
        <div class="flex flex-col gap-2 text-center sm:text-left">
          <AlertDialogTitle class="text-foreground text-lg font-semibold">
            Your session has ended
          </AlertDialogTitle>
          <AlertDialogDescription class="text-muted-foreground text-sm">
            Sign in to continue where you left off.
          </AlertDialogDescription>
        </div>
        <AuthForm
          v-if="authStore.sessionEnded"
          embedded
          :initial-email="authStore.user?.email"
          :submitting="submitting"
          :error-message="errorMessage"
          @submit="onSubmit"
        />
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
