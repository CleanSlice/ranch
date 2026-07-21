<script setup lang="ts">
import { IconAlertTriangle, IconEye, IconEyeOff } from '@tabler/icons-vue';
const props = defineProps<{
  submitting?: boolean;
  errorMessage?: string | null;
}>();

const showPassword = ref(false);

const emit = defineEmits<{
  submit: [values: { email: string; password: string }];
}>();

const form = reactive({ email: '', password: '' });
const errors = reactive<Partial<Record<'email' | 'password', string>>>({});

function validate() {
  const email = form.email.trim();
  if (!email) errors.email = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Invalid email';
  else errors.email = undefined;
  if (!form.password) errors.password = 'Password is required';
  else errors.password = undefined;
  return !errors.email && !errors.password;
}

function onSubmit() {
  if (!validate()) return;
  emit('submit', { email: form.email.trim(), password: form.password });
}
</script>

<template>
  <Card class="w-full max-w-sm">
    <CardHeader>
      <CardTitle>Sign in</CardTitle>
      <CardDescription>Enter your credentials to access the admin.</CardDescription>
    </CardHeader>
    <CardContent>
      <form class="grid gap-4" @submit.prevent="onSubmit">
        <div class="grid gap-2">
          <Label for="email">Email</Label>
          <Input
            id="email"
            v-model="form.email"
            type="email"
            autocomplete="email"
            placeholder="jane@example.com"
            :aria-invalid="!!errors.email"
          />
          <p v-if="errors.email" class="text-xs text-destructive">{{ errors.email }}</p>
        </div>
        <div class="grid gap-2">
          <Label for="password">Password</Label>
          <div class="relative">
            <Input
              id="password"
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              :aria-invalid="!!errors.password"
              class="pr-9"
            />
            <button
              type="button"
              class="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition hover:text-foreground"
              :aria-label="showPassword ? 'Hide password' : 'Show password'"
              @click="showPassword = !showPassword"
            >
              <IconEyeOff v-if="showPassword" class="size-4" />
              <IconEye v-else class="size-4" />
            </button>
          </div>
          <p v-if="errors.password" class="text-xs text-destructive">{{ errors.password }}</p>
        </div>
        <div
          v-if="props.errorMessage"
          class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
        >
          <IconAlertTriangle class="mt-px size-3.5 shrink-0" />
          <span>{{ props.errorMessage }}</span>
        </div>
        <Button type="submit" :disabled="submitting" class="w-full">
          {{ submitting ? 'Signing in…' : 'Sign in' }}
        </Button>
      </form>
    </CardContent>
  </Card>
</template>
