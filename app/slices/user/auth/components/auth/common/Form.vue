<script setup lang="ts">
type Mode = 'login' | 'register';

const props = defineProps<{
  mode: Mode;
  submitting?: boolean;
  /** What the API said, shown exactly as received — not a key, not translated.
   *  Null when it said nothing worth showing; then `errorKey` speaks. */
  errorMessage?: string | null;
  /** i18n key for the console's own words about the failure. Null when the
   *  failure could not be told apart, in which case `failed` drives our copy. */
  errorKey?: string | null;
  failed?: boolean;
  registrationEnabled?: boolean;
  /** Starting value for the email field — the session-ended dialog knows who was signed in. */
  initialEmail?: string;
  /** Drop the built-in heading / footer links when a host renders its own copy around the form. */
  hideHeading?: boolean;
  hideFooter?: boolean;
  /** Replace the idle submit label with another i18n key; the pending label is unchanged. */
  submitLabelKey?: string;
  /**
   * `console` is the shadcn look the session-ended dialog needs; `gate` is
   * the sign-in page's panel (landing design language: pill fields, dark
   * pill button).
   */
  variant?: 'console' | 'gate';
}>();

// The gate's route visualization follows what happens here. Outside the
// gate the setter is a no-op (see useGateStage).
const { set: setStage } = useGateStage();
watch(
  () => props.submitting,
  (busy) => {
    if (busy) setStage('connecting');
  },
);
watch(
  () => props.failed || !!props.errorMessage,
  (bad) => {
    if (bad) setStage('failed');
  },
);
function onFieldFocus() {
  if (!props.submitting) setStage('filling');
}

const emit = defineEmits<{
  submit: [values: { name?: string; email: string; password: string }];
}>();

const form = reactive({ name: '', email: props.initialEmail ?? '', password: '' });
watch(
  () => props.initialEmail,
  (email) => {
    if (email && !form.email) form.email = email;
  },
);
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
  if (props.submitLabelKey) return props.submitLabelKey;
  return props.mode === 'login'
    ? 'account.submit_login'
    : 'account.submit_register';
});

const failureKey = computed(
  () =>
    props.errorKey ??
    (props.mode === 'login' ? 'account.login_failed' : 'account.register_failed'),
);

const gate = computed(() => props.variant === 'gate');

const inputClass = (field: 'name' | 'email' | 'password') =>
  gate.value
    ? [
        'w-full h-12 rounded-2xl border bg-white pl-11 pr-3 text-[0.95rem] text-[#1a1421] transition',
        'placeholder:text-[#8a7f94]',
        'focus:outline-none focus:ring-2 focus:ring-[#f5a16b]/45 focus:border-[#d77b61]',
        touched[field] && errors[field]
          ? 'border-[#d6453d]/60 focus:border-[#d6453d] focus:ring-[#d6453d]/25'
          : 'border-[#1a1421]/15',
      ].join(' ')
    : [
        'w-full rounded-md border bg-background pl-10 pr-3 py-2.5 text-sm transition',
        'placeholder:text-muted-foreground/60',
        'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary',
        touched[field] && errors[field]
          ? 'border-destructive/60 focus:border-destructive focus:ring-destructive/30'
          : 'border-input',
      ].join(' ');

const labelClass = computed(() =>
  gate.value
    ? 'mb-1.5 block text-[0.8rem] font-medium text-[#3b3344]'
    : 'mb-1.5 block text-xs font-medium text-foreground/80',
);
const iconClass = computed(() =>
  gate.value
    ? 'pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#8a7f94]'
    : 'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground',
);
const submitClass = computed(() =>
  gate.value
    ? 'group relative flex w-full h-12 items-center justify-center gap-2 rounded-full bg-[#1a1421] text-[#f8f5fa] px-5 text-[0.95rem] font-semibold transition hover:bg-[#2a2033] hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5a16b]'
    : 'group relative flex w-full items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium shadow-sm hover:opacity-95 disabled:opacity-60 disabled:cursor-not-allowed transition',
);

function showError(field: 'name' | 'email' | 'password') {
  return touched[field] && !!errors[field];
}
</script>

<template>
  <div>
    <div v-if="!hideHeading" :class="gate ? 'mb-6' : 'mb-8'">
      <h1 :class="gate ? 'text-[1.65rem] font-semibold tracking-[-0.02em] text-[#1a1421]' : 'text-2xl font-bold tracking-tight'">{{ $t(titleKey) }}</h1>
      <p :class="gate ? 'mt-1.5 text-sm text-[#6e6478]' : 'mt-1.5 text-sm text-muted-foreground'">{{ $t(subtitleKey) }}</p>
    </div>

    <form class="space-y-4" novalidate @submit.prevent="onSubmit">
      <div v-if="mode === 'register'">
        <label
          for="auth-name"
          :class="labelClass"
        >
          {{ $t('account.name_label') }}
        </label>
        <div class="relative">
          <Icon
            name="user"
            :size="16"
            :class="iconClass"
          />
          <input
            id="auth-name"
            v-model="form.name"
            type="text"
            autocomplete="name"
            :placeholder="$t('account.name_placeholder')"
            :aria-invalid="showError('name')"
            :class="inputClass('name')"
            @focus="onFieldFocus"
            @input="onFieldFocus"
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
          :class="labelClass"
        >
          {{ $t('account.email_label') }}
        </label>
        <div class="relative">
          <Icon
            name="mail"
            :size="16"
            :class="iconClass"
          />
          <input
            id="auth-email"
            v-model="form.email"
            type="email"
            autocomplete="email"
            :placeholder="$t('account.email_placeholder')"
            :aria-invalid="showError('email')"
            :class="inputClass('email')"
            @focus="onFieldFocus"
            @input="onFieldFocus"
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
            :class="[labelClass, 'mb-0']"
          >
            {{ $t('account.password_label') }}
          </label>
          <span
            v-if="mode === 'register'"
:class="gate ? 'font-mono text-[0.68rem] text-[#8a7f94]' : 'text-xs text-muted-foreground'"
          >
            {{ $t('account.password_hint') }}
          </span>
        </div>
        <div class="relative">
          <Icon
            name="lock"
            :size="16"
            :class="iconClass"
          />
          <input
            id="auth-password"
            v-model="form.password"
            :type="showPassword ? 'text' : 'password'"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            placeholder="••••••••"
            :aria-invalid="showError('password')"
            :class="[inputClass('password'), 'pr-10']"
            @focus="onFieldFocus"
            @input="onFieldFocus"
            @blur="onBlur('password')"
          />
          <button
            type="button"
            :class="gate ? 'absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-[#8a7f94] hover:text-[#1a1421] hover:bg-[#1a1421]/5 transition' : 'absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition'"
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
        :class="submitClass"
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

    <div v-if="!hideFooter" :class="gate ? 'mt-6 text-center text-sm text-[#6e6478]' : 'mt-6 text-center text-sm text-muted-foreground'">
      <template v-if="mode === 'login'">
        <span v-if="registrationEnabled">
          {{ $t('account.new_here') }}
          <NuxtLink to="/register" :class="gate ? 'font-semibold text-[#1a1421] hover:text-[#d77b61] transition' : 'font-medium text-foreground hover:text-primary transition'">
            {{ $t('account.create_account') }}
          </NuxtLink>
        </span>
        <span v-else>
          {{ $t('account.need_access') }}
        </span>
      </template>
      <template v-else>
        {{ $t('account.have_account') }}
        <NuxtLink to="/login" :class="gate ? 'font-semibold text-[#1a1421] hover:text-[#d77b61] transition' : 'font-medium text-foreground hover:text-primary transition'">
          {{ $t('account.sign_in') }}
        </NuxtLink>
      </template>
    </div>
  </div>
</template>
