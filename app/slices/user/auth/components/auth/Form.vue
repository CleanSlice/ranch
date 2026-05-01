<script setup lang="ts">
type Mode = 'login' | 'register';

const props = defineProps<{
  mode: Mode;
  submitting?: boolean;
  errorMessage?: string | null;
  registrationEnabled?: boolean;
}>();

const emit = defineEmits<{
  submit: [values: { name?: string; email: string; password: string }];
}>();

const form = reactive({ name: '', email: '', password: '' });
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
      props.mode === 'register' && !form.name.trim() ? 'Name is required' : undefined;
    return;
  }
  if (field === 'email') {
    const email = form.email.trim();
    if (!email) errors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errors.email = 'Enter a valid email';
    else errors.email = undefined;
    return;
  }
  if (field === 'password') {
    if (!form.password) errors.password = 'Password is required';
    else if (props.mode === 'register' && form.password.length < 8)
      errors.password = 'At least 8 characters';
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

const title = computed(() =>
  props.mode === 'login' ? 'Welcome back' : 'Create your account',
);

const subtitle = computed(() =>
  props.mode === 'login'
    ? 'Sign in to manage your agents.'
    : 'Get started with your AI workers.',
);

const submitLabel = computed(() =>
  props.submitting
    ? props.mode === 'login'
      ? 'Signing in…'
      : 'Creating account…'
    : props.mode === 'login'
      ? 'Sign in'
      : 'Create account',
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
      <h1 class="text-2xl font-bold tracking-tight">{{ title }}</h1>
      <p class="mt-1.5 text-sm text-muted-foreground">{{ subtitle }}</p>
    </div>

    <form class="space-y-4" novalidate @submit.prevent="onSubmit">
      <div v-if="mode === 'register'">
        <label
          for="auth-name"
          class="mb-1.5 block text-xs font-medium text-foreground/80"
        >
          Name
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
            placeholder="Jane Doe"
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
          {{ errors.name }}
        </p>
      </div>

      <div>
        <label
          for="auth-email"
          class="mb-1.5 block text-xs font-medium text-foreground/80"
        >
          Email
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
            placeholder="jane@example.com"
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
          {{ errors.email }}
        </p>
      </div>

      <div>
        <div class="mb-1.5 flex items-center justify-between">
          <label
            for="auth-password"
            class="block text-xs font-medium text-foreground/80"
          >
            Password
          </label>
          <span
            v-if="mode === 'register'"
            class="text-xs text-muted-foreground"
          >
            Min 8 characters
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
            :aria-label="showPassword ? 'Hide password' : 'Show password'"
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
          {{ errors.password }}
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
          v-if="errorMessage"
          class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
        >
          <Icon name="alert-triangle" :size="14" class="mt-px shrink-0" />
          <span>{{ errorMessage }}</span>
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
        {{ submitLabel }}
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
          New here?
          <NuxtLink to="/register" class="font-medium text-foreground hover:text-primary transition">
            Create an account
          </NuxtLink>
        </span>
        <span v-else>
          Need access? Ask an admin to invite you.
        </span>
      </template>
      <template v-else>
        Already have an account?
        <NuxtLink to="/login" class="font-medium text-foreground hover:text-primary transition">
          Sign in
        </NuxtLink>
      </template>
    </div>
  </div>
</template>
