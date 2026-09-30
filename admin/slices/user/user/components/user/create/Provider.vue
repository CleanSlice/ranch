<script setup lang="ts">
import type { ICreateUserData } from '#user/domain/user.types';

const userStore = useUserStore();
const submitting = ref(false);

async function onSubmit(values: ICreateUserData) {
  submitting.value = true;
  const created = await userStore.create(values);
  submitting.value = false;
  await navigateTo(`/users/${created.id}`);
}

function onCancel() {
  navigateTo('/users');
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageBreadcrumbs :items="[{ label: 'Users', to: '/users' }, { label: 'Create user' }]" />

    <div>
      <h1 class="text-2xl font-semibold">Create user</h1>
      <p class="text-sm text-muted-foreground">Grant access to this workspace.</p>
    </div>

    <UserItemForm
      :submitting="submitting"
      @submit="onSubmit"
      @cancel="onCancel"
    />
  </div>
</template>
