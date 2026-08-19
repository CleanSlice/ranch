<script setup lang="ts">
type Mode = 'login' | 'register';

const props = defineProps<{
  mode: Mode;
  submitting?: boolean;
  /** Human text from the API — already English, not a key. Null when the call
   *  failed without a usable message, in which case `failed` drives our copy. */
  errorMessage?: string | null;
  failed?: boolean;
  registrationEnabled?: boolean;
}>();

const emit = defineEmits<{
  submit: [values: { name?: string; email: string; password: string }];
}>();

const form = reactive({ name: '', email: '', password: '' });
// Validation state holds i18n KEYS, not sentences: the template renders them
// with $t. Keeping the text here would hide user-visible copy inside branching
// logic, where the next extraction pass would never find it.
const errors = reactive<
  Partial<Record<'name' | 'email' | 'password', string>>
>({});
const touched = reactive<
  Partial<Record<'name' | 'email' | 'password', boolean>>
>({});
const showPassword = ref(false);

function validateField(field: 'name' | 'email' | 'password') {
  if (field === 'name') {
    errors.name =
      props.mode === 'register' && !form.name.trim()
        ? 'account.name_required'
        : undefined;
    return;
  }
  if (field === 'email') {
    const email = form.email.trim();
    if (!email) errors.email = 'account.email_required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errors.email = 'account.email_invalid';
    else errors.email = undefined;
    return;
  }
  if (field === 'password') {
    if (!form.password) errors.password = 'account.password_required';
    else if (props.mode === 'register' && form.password.length < 8)
      errors.password = 'account.password_too_short';
    else errors.password = undefined;
  }
}

function onBlur(field: 'name' | 'email' | 'password') {
  touched[field] = true;
  validateField(field);
}

function validateAll(): boolean {
  validateField('name');
  validateField('email');
  validateField('password');
  touched.name = touched.email = touched.password = true;
  return !errors.name && !errors.email && !errors.password;
}

function onSubmit() {
  if (!validateAll()) return;
  emit('submit', {
    ...(props.mode === 'register' ? { name: form.name.trim() } : {}),
    email: form.email.trim(),
    password: form.password,
  });
}

const titleKey = computed(() =>
  props.mode === 'login' ? 'account.welcome_title' : 'account.create_title',
);

const subtitleKey = computed(() =>
  props.mode === 'login'
    ? 'account.welcome_subtitle'
    : 'account.create_subtitle',
);

const submitLabelKey = computed(() => {
  if (props.submitting) {
    return props.mode === 'login'
      ? 'account.submit_login_pending'
      : 'account.submit_register_pending';
  }
  return props.mode === 'login'
    ? 'account.submit_login'
    : 'account.submit_register';
});

const failureKey = computed(() =>
  props.mode === 'login' ? 'account.login_failed' : 'account.register_failed',
);

const inputClass = (field: 'name' | 'email' | 'password') =>
  [
    'w-full rounded-md border bg-background pl-10 pr-3 py-2.5 text-sm transition',
    'placeholder:text-muted-foreground/60',
    'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary',
    touched[field] && errors[field]
      ? 'border-destructive/60 focus:border-destructive focus:ring-destructive/30'
      : 'border-input',
  ].join(' ');

function showError(field: 'name' | 'email' | 'password') {
  return touched[field] && !!errors[field];
}
</script>

<template>
  <div>
    <div class="mb-8">
      <h1 class="text-2xl font-bold tracking-tight">{{ $t(titleKey) }}</h1>
      <p class="mt-1.5 text-sm text-muted-foreground">{{ $t(subtitleKey) }}</p>
    </div>

    <form class="space-y-4" novalidate @submit.prevent="onSubmit">
      <div v-if="mode === 'register'">
        <label
          for="auth-name"
          class="mb-1.5 block text-xs font-medium text-foreground/80"
        >
          {{ $t('account.name_label') }}
        </label>
        <div class="relative">
          <Icon
            name="user"
            :size="16"
            class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id="auth-name"
            v-model="form.name"
            type="text"
            autocomplete="name"
            :placeholder="$t('account.name_placeholder')"
            :aria-invalid="showError('name')"
            :class="inputClass('name')"
            @blur="onBlur('name')"
          />
        </div>
        <p
          v-if="showError('name')"
          class="mt-1.5 text-xs text-destructive flex items-center gap-1"
        >
          <Icon name="alert-circle" :size="12" />
          {{ $t(errors.name!) }}
        </p>
      </div>

      <div>
        <label
          for="auth-email"
          class="mb-1.5 block text-xs font-medium text-foreground/80"
        >
          {{ $t('account.email_label') }}
        </label>
        <div class="relative">
          <Icon
            name="mail"
            :size="16"
            class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id="auth-email"
            v-model="form.email"
            type="email"
            autocomplete="email"
            :placeholder="$t('account.email_placeholder')"
            :aria-invalid="showError('email')"
            :class="inputClass('email')"
            @blur="onBlur('email')"
          />
        </div>
        <p
          v-if="showError('email')"
          class="mt-1.5 text-xs text-destructive flex items-center gap-1"
        >
          <Icon name="alert-circle" :size="12" />
          {{ $t(errors.email!) }}
        </p>
      </div>

      <div>
        <div class="mb-1.5 flex items-center justify-between">
          <label
            for="auth-password"
            class="block text-xs font-medium text-foreground/80"
          >
            {{ $t('account.password_label') }}
          </label>
          <span
            v-if="mode === 'register'"
            class="text-xs text-muted-foreground"
          >
            {{ $t('account.password_hint') }}
          </span>
        </div>
        <div class="relative">
          <Icon
            name="lock"
            :size="16"
            class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id="auth-password"
            v-model="form.password"
            :type="showPassword ? 'text' : 'password'"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            placeholder="••••••••"
            :aria-invalid="showError('password')"
            :class="[inputClass('password'), 'pr-10']"
            @blur="onBlur('password')"
          />
          <button
            type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition"
            :aria-label="
              $t(showPassword ? 'account.password_hide' : 'account.password_show')
            "
            @click="showPassword = !showPassword"
          >
            <Icon :name="showPassword ? 'eye-off' : 'eye'" :size="16" />
          </button>
        </div>
        <p
          v-if="showError('password')"
          class="mt-1.5 text-xs text-destructive flex items-center gap-1"
        >
          <Icon name="alert-circle" :size="12" />
          {{ $t(errors.password!) }}
        </p>
      </div>

      <Transition
        enter-active-class="transition-all duration-200 ease-out"
        enter-from-class="opacity-0 -translate-y-1"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition-all duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="failed || errorMessage"
          class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
        >
          <Icon name="alert-triangle" :size="14" class="mt-px shrink-0" />
          <span>{{ errorMessage ?? $t(failureKey) }}</span>
        </div>
      </Transition>

      <button
        type="submit"
        :disabled="submitting"
        class="group relative flex w-full items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium shadow-sm hover:opacity-95 disabled:opacity-60 disabled:cursor-not-allowed transition"
      >
        <Icon
          v-if="submitting"
          name="loader-2"
          :size="16"
          class="animate-spin"
        />
        {{ $t(submitLabelKey) }}
        <Icon
          v-if="!submitting"
          name="arrow-right"
          :size="14"
          class="transition-transform group-hover:translate-x-0.5"
        />
      </button>
    </form>

    <div class="mt-6 text-center text-sm text-muted-foreground">
      <template v-if="mode === 'login'">
        <span v-if="registrationEnabled">
          {{ $t('account.new_here') }}
          <NuxtLink to="/register" class="font-medium text-foreground hover:text-primary transition">
            {{ $t('account.create_account') }}
          </NuxtLink>
        </span>
        <span v-else>
          {{ $t('account.need_access') }}
        </span>
      </template>
      <template v-else>
        {{ $t('account.have_account') }}
        <NuxtLink to="/login" class="font-medium text-foreground hover:text-primary transition">
          {{ $t('account.sign_in') }}
        </NuxtLink>
      </template>
    </div>
  </div>
</template>
