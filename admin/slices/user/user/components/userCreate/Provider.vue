<script setup lang="ts">
import type { ICreateUserData } from '#user/stores/user';
import { IconArrowLeft } from '@tabler/icons-vue';

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
    <NuxtLink
      to="/users"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <IconArrowLeft class="size-4" /> Back to users
    </NuxtLink>

    <div>
      <h1 class="text-2xl font-semibold">Invite user</h1>
      <p class="text-sm text-muted-foreground">Grant access to this workspace.</p>
    </div>

    <UserForm
      :submitting="submitting"
      submit-label="Send invite"
      @submit="onSubmit"
      @cancel="onCancel"
    />
  </div>
</template>
