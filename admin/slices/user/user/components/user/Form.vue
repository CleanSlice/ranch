<script setup lang="ts">
import {
  ALL_USER_ROLES,
  UserRoleTypes,
  type ICreateUserData,
} from '#user/stores/user';
import { Button } from '#theme/components/ui/button';
import { Checkbox } from '#theme/components/ui/checkbox';
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
  initialValues?: ICreateUserData;
  submitLabel?: string;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  submit: [values: ICreateUserData];
  cancel: [];
}>();

const form = reactive<ICreateUserData>({
  name: props.initialValues?.name ?? '',
  email: props.initialValues?.email ?? '',
  password: props.initialValues?.password ?? '',
  roles: props.initialValues?.roles?.length
    ? [...props.initialValues.roles]
    : [UserRoleTypes.User],
});

const errors = reactive<
  Partial<Record<'name' | 'email' | 'password' | 'roles', string>>
>({});

function isChecked(role: UserRoleTypes) {
  return form.roles.includes(role);
}

function toggleRole(role: UserRoleTypes, checked: boolean) {
  if (checked) {
    if (!form.roles.includes(role)) form.roles = [...form.roles, role];
  } else {
    form.roles = form.roles.filter((r) => r !== role);
  }
}

function validate() {
  errors.name = form.name.trim() ? undefined : 'Name is required';
  const email = form.email.trim();
  if (!email) errors.email = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Invalid email';
  else errors.email = undefined;
  if (!form.password) errors.password = 'Password is required';
  else if (form.password.length < 8) errors.password = 'Min 8 characters';
  else errors.password = undefined;
  errors.roles = form.roles.length ? undefined : 'Pick at least one role';
  return !errors.name && !errors.email && !errors.password && !errors.roles;
}

function onSubmit() {
  if (!validate()) return;
  emit('submit', {
    name: form.name.trim(),
    email: form.email.trim(),
    password: form.password,
    roles: [...form.roles],
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
          <Label>Roles</Label>
          <p class="text-xs text-muted-foreground">
            A user can hold any combination. Owner can change other users' roles.
          </p>
          <div class="flex flex-wrap gap-4 pt-1">
            <label
              v-for="role in ALL_USER_ROLES"
              :key="role"
              :for="`role-${role}`"
              class="flex items-center gap-2 text-sm"
            >
              <Checkbox
                :id="`role-${role}`"
                :model-value="isChecked(role)"
                @update:model-value="(v: boolean | 'indeterminate') => toggleRole(role, v === true)"
              />
              {{ role }}
            </label>
          </div>
          <p v-if="errors.roles" class="text-xs text-destructive">{{ errors.roles }}</p>
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
