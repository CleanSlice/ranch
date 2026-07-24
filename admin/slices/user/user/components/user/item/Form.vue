<script setup lang="ts">
import {
  ASSIGNABLE_USER_ROLES,
  UserRoleTypes,
  type ICreateUserData,
} from '#user/domain/user.types';

const props = withDefaults(
  defineProps<{
    mode?: 'create' | 'edit';
    initialValues?: Partial<ICreateUserData>;
    showRole?: boolean;
    // Editing the Owner: the role is fixed — render a badge instead of the picker.
    roleLocked?: boolean;
    submitLabel?: string;
    submitting?: boolean;
    cardTitle?: string;
    cardDescription?: string;
  }>(),
  { mode: 'create', showRole: true, roleLocked: false },
);

const emit = defineEmits<{
  submit: [values: ICreateUserData];
  cancel: [];
}>();

const form = reactive<ICreateUserData>({
  name: props.initialValues?.name ?? '',
  email: props.initialValues?.email ?? '',
  password: props.initialValues?.password ?? '',
  role: props.initialValues?.role ?? UserRoleTypes.User,
});

const errors = reactive<
  Partial<Record<'name' | 'email' | 'password', string>>
>({});

function validate() {
  errors.name = form.name.trim() ? undefined : 'Name is required';
  const email = form.email.trim();
  if (!email) errors.email = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Invalid email';
  else errors.email = undefined;

  // In edit mode the password is optional — only validate when filled.
  if (props.mode === 'edit') {
    errors.password = form.password && form.password.length < 8 ? 'Min 8 characters' : undefined;
  } else {
    if (!form.password) errors.password = 'Password is required';
    else if (form.password.length < 8) errors.password = 'Min 8 characters';
    else errors.password = undefined;
  }

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
        <CardTitle>{{ cardTitle ?? (mode === 'edit' ? 'Profile' : 'New user') }}</CardTitle>
        <CardDescription>
          {{
            cardDescription ??
            (mode === 'edit'
              ? 'Update the user\'s profile.'
              : 'Set a password and share it with the user — no email is sent.')
          }}
        </CardDescription>
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
          <Label for="password">{{ mode === 'edit' ? 'New password' : 'Password' }}</Label>
          <Input
            id="password"
            v-model="form.password"
            type="password"
            autocomplete="new-password"
            :placeholder="mode === 'edit' ? 'Leave blank to keep current' : 'At least 8 characters'"
            :aria-invalid="!!errors.password"
          />
          <p v-if="errors.password" class="text-xs text-destructive">{{ errors.password }}</p>
        </div>
        <div v-if="showRole" class="grid gap-2">
          <Label>Role</Label>
          <template v-if="roleLocked">
            <div class="pt-1">
              <Badge variant="secondary">{{ form.role }}</Badge>
            </div>
            <p class="text-xs text-muted-foreground">
              The Owner role is fixed — it cannot be granted or revoked.
            </p>
          </template>
          <template v-else>
            <p class="text-xs text-muted-foreground">
              Admins can manage the workspace; the single Owner is set at install time.
            </p>
            <RadioGroup v-model="form.role" class="flex flex-wrap gap-4 pt-1">
              <label
                v-for="role in ASSIGNABLE_USER_ROLES"
                :key="role"
                :for="`role-${role}`"
                class="flex items-center gap-2 text-sm"
              >
                <RadioGroupItem :id="`role-${role}`" :value="role" />
                {{ role }}
              </label>
            </RadioGroup>
          </template>
        </div>
      </CardContent>
    </Card>

    <div class="flex items-center gap-3">
      <Button type="submit" :disabled="submitting">
        {{
          submitting
            ? (mode === 'edit' ? 'Saving…' : 'Creating…')
            : (submitLabel ?? (mode === 'edit' ? 'Save' : 'Create user'))
        }}
      </Button>
      <Button type="button" variant="ghost" @click="emit('cancel')">Cancel</Button>
    </div>
  </form>
</template>
