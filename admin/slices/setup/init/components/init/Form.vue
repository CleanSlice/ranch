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
  submit: [values: { name: string; email: string; password: string }];
}>();

const form = reactive({ name: '', email: '', password: '' });
const errors = reactive<Partial<Record<'name' | 'email' | 'password', string>>>({});

function validate() {
  errors.name = form.name.trim() ? undefined : 'Name is required';
  const email = form.email.trim();
  if (!email) errors.email = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Invalid email';
  else errors.email = undefined;
  if (!form.password) errors.password = 'Password is required';
  else if (form.password.length < 8) errors.password = 'Min 8 characters';
  else errors.password = undefined;
  return !errors.name && !errors.email && !errors.password;
}

function onSubmit() {
  if (!validate()) return;
  emit('submit', {
    name: form.name.trim(),
    email: form.email.trim(),
    password: form.password,
  });
}
</script>

<template>
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Welcome to Ranch</CardTitle>
      <CardDescription>
        No owner exists yet. Create the first owner account to get started.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form class="grid gap-4" @submit.prevent="onSubmit">
        <div class="grid gap-2">
          <Label for="name">Name</Label>
          <Input
            id="name"
            v-model="form.name"
            autocomplete="name"
            placeholder="Jane Doe"
            :aria-invalid="!!errors.name"
          />
          <p v-if="errors.name" class="text-xs text-destructive">{{ errors.name }}</p>
        </div>
        <div class="grid gap-2">
          <Label for="email">Email</Label>
          <Input
            id="email"
            v-model="form.email"
            type="email"
            autocomplete="email"
            placeholder="owner@example.com"
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
            autocomplete="new-password"
            placeholder="At least 8 characters"
            :aria-invalid="!!errors.password"
          />
          <p v-if="errors.password" class="text-xs text-destructive">{{ errors.password }}</p>
        </div>
        <p v-if="props.errorMessage" class="text-xs text-destructive">{{ props.errorMessage }}</p>
        <Button type="submit" :disabled="submitting" class="w-full">
          {{ submitting ? 'Creating…' : 'Create owner' }}
        </Button>
      </form>
    </CardContent>
  </Card>
</template>
