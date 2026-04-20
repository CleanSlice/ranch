<script setup lang="ts">
import { UserRoleTypes, type ICreateUserData } from '#user/stores/user';
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#theme/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';

const props = defineProps<{
  initialValues?: ICreateUserData;
  submitLabel?: string;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  submit: [values: ICreateUserData];
  cancel: [];
}>();

const roleOptions = [
  { value: UserRoleTypes.Admin, label: 'Admin' },
  { value: UserRoleTypes.Member, label: 'Member' },
];

const form = reactive<ICreateUserData>({
  name: props.initialValues?.name ?? '',
  email: props.initialValues?.email ?? '',
  password: props.initialValues?.password ?? '',
  role: props.initialValues?.role ?? UserRoleTypes.Member,
});

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
    role: form.role,
  });
}
</script>

<template>
  <form class="flex flex-col gap-6" @submit.prevent="onSubmit">
    <Card>
      <CardHeader>
        <CardTitle>Invite</CardTitle>
        <CardDescription>An invitation email will be sent to the address below.</CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <div class="grid gap-2">
          <Label for="name">Name</Label>
          <Input id="name" v-model="form.name" placeholder="Jane Doe" :aria-invalid="!!errors.name" />
          <p v-if="errors.name" class="text-xs text-destructive">{{ errors.name }}</p>
        </div>
        <div class="grid gap-2">
          <Label for="email">Email</Label>
          <Input id="email" v-model="form.email" type="email" placeholder="jane@example.com" :aria-invalid="!!errors.email" />
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
        <div class="grid gap-2">
          <Label for="role">Role</Label>
          <Select v-model="form.role">
            <SelectTrigger id="role">
              <SelectValue placeholder="Choose a role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in roleOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>

    <div class="flex items-center gap-3">
      <Button type="submit" :disabled="submitting">
        {{ submitting ? 'Sending…' : (submitLabel ?? 'Send invite') }}
      </Button>
      <Button type="button" variant="ghost" @click="emit('cancel')">Cancel</Button>
    </div>
  </form>
</template>
