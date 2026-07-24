<script setup lang="ts">
import { UserStatusTypes, UserRoleTypes } from '#user/domain/user.types';

const props = defineProps<{ id: string }>();
const userStore = useUserStore();

const { data: user, pending } = await useAsyncData(
  `admin-user-${props.id}`,
  () => userStore.fetchById(props.id),
);

const statusVariant: Record<UserStatusTypes, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  [UserStatusTypes.Active]: 'default',
  [UserStatusTypes.Invited]: 'secondary',
  [UserStatusTypes.Disabled]: 'outline',
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

const confirmRemoveOpen = ref(false);

async function onRemove() {
  if (!user.value) return;
  await userStore.remove(user.value.id);
  await navigateTo('/users');
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink to="/users" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <IconArrowLeft class="size-4" /> Back to users
    </NuxtLink>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <template v-else-if="user">
      <div class="flex items-start justify-between gap-4">
        <div class="flex items-center gap-4">
          <Avatar class="size-14">
            <AvatarFallback class="text-base">{{ user.initials }}</AvatarFallback>
          </Avatar>
          <div>
            <h1 class="text-2xl font-semibold">{{ user.name }}</h1>
            <p class="text-sm text-muted-foreground">{{ user.email }}</p>
          </div>
        </div>
        <div class="flex gap-2">
          <Button variant="outline" @click="navigateTo(`/users/${user.id}/edit`)">Edit</Button>
          <Button
            variant="ghost"
            class="text-destructive"
            :disabled="user.roles.includes(UserRoleTypes.Owner)"
            @click="confirmRemoveOpen = true"
          >
            Remove
          </Button>
        </div>
      </div>

      <ConfirmDialog
        v-model:open="confirmRemoveOpen"
        title="Remove user"
        :description="`Permanently remove ${user.name} (${user.email})? They will lose all access immediately.`"
        confirm-label="Remove user"
        @confirm="onRemove"
      />

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Access and membership details.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt class="text-xs text-muted-foreground">Roles</dt>
              <dd class="mt-1 flex flex-wrap gap-1">
                <Badge
                  v-for="role in user.roles"
                  :key="role"
                  variant="secondary"
                >
                  {{ role }}
                </Badge>
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">Status</dt>
              <dd class="mt-1">
                <Badge :variant="statusVariant[user.status]" class="capitalize">{{ user.status }}</Badge>
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">Joined</dt>
              <dd class="mt-1 text-sm">{{ formatDate(user.createdAt) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">ID</dt>
              <dd class="mt-1 text-sm text-muted-foreground">{{ user.id }}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </template>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      User not found.
    </div>
  </div>
</template>
