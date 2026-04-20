<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';

const props = defineProps<{
  submitting?: boolean;
  errorMessage?: string | null;
}>();

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
          <Input
            id="password"
            v-model="form.password"
            type="password"
            autocomplete="current-password"
            :aria-invalid="!!errors.password"
          />
          <p v-if="errors.password" class="text-xs text-destructive">{{ errors.password }}</p>
        </div>
        <p v-if="props.errorMessage" class="text-xs text-destructive">{{ props.errorMessage }}</p>
        <Button type="submit" :disabled="submitting" class="w-full">
          {{ submitting ? 'Signing in…' : 'Sign in' }}
        </Button>
      </form>
    </CardContent>
  </Card>
</template>
