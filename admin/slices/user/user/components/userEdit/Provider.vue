<script setup lang="ts">
import type { ICreateUserData, IUpdateUserData } from '#user/stores/user';
import { IconArrowLeft } from '@tabler/icons-vue';

const props = defineProps<{ id: string }>();
const userStore = useUserStore();

const { data: user, pending } = await useAsyncData(
  `admin-user-edit-${props.id}`,
  () => userStore.fetchById(props.id),
);

const submitting = ref(false);

async function onSubmit(values: ICreateUserData) {
  if (!user.value) return;
  const patch: IUpdateUserData = {};
  if (values.name && values.name !== user.value.name) patch.name = values.name;
  if (values.email && values.email !== user.value.email) patch.email = values.email;
  if (values.password) patch.password = values.password;

  if (Object.keys(patch).length === 0) {
    await navigateTo(`/users/${props.id}`);
    return;
  }

  submitting.value = true;
  try {
    await userStore.update(props.id, patch);
  } finally {
    submitting.value = false;
  }
  await navigateTo(`/users/${props.id}`);
}

function onCancel() {
  navigateTo(`/users/${props.id}`);
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      :to="`/users/${id}`"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <IconArrowLeft class="size-4" /> Back to user
    </NuxtLink>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <template v-else-if="user">
      <div>
        <h1 class="text-2xl font-semibold">Edit {{ user.name }}</h1>
        <p class="text-sm text-muted-foreground">Update profile fields. Roles are managed separately.</p>
      </div>

      <UserForm
        mode="edit"
        :show-roles="false"
        :submitting="submitting"
        :initial-values="{ name: user.name, email: user.email, password: '' }"
        @submit="onSubmit"
        @cancel="onCancel"
      />
    </template>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      User not found.
    </div>
  </div>
</template>
