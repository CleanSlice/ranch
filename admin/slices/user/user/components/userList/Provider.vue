<script setup lang="ts">
import { UserStatusTypes, type IUserData } from '#user/stores/user';
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import {
  Avatar,
  AvatarFallback,
} from '#theme/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#theme/components/ui/table';

const userStore = useUserStore();

const { data: users, pending, refresh } = await useAsyncData(
  'admin-users',
  () => userStore.fetchAll(),
);

const statusVariant: Record<UserStatusTypes, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  [UserStatusTypes.Active]: 'default',
  [UserStatusTypes.Invited]: 'secondary',
  [UserStatusTypes.Disabled]: 'outline',
};

const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

async function onRemove(user: IUserData) {
  await userStore.remove(user.id);
  await refresh();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Users</h1>
        <p class="text-sm text-muted-foreground">People with access to this workspace.</p>
      </div>
      <Button as-child>
        <NuxtLink to="/users/create">Invite user</NuxtLink>
      </Button>
    </div>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading users…</div>

    <div v-else-if="users?.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="user in users"
            :key="user.id"
            class="cursor-pointer"
            @click="navigateTo(`/users/${user.id}`)"
          >
            <TableCell>
              <div class="flex items-center gap-3">
                <Avatar class="size-8">
                  <AvatarFallback>{{ initials(user.name) }}</AvatarFallback>
                </Avatar>
                <div>
                  <div class="font-medium">{{ user.name }}</div>
                  <div class="text-xs text-muted-foreground">{{ user.email }}</div>
                </div>
              </div>
            </TableCell>
            <TableCell class="capitalize text-muted-foreground">{{ user.role }}</TableCell>
            <TableCell>
              <Badge :variant="statusVariant[user.status]" class="capitalize">
                {{ user.status }}
              </Badge>
            </TableCell>
            <TableCell class="text-muted-foreground">
              {{ new Date(user.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) }}
            </TableCell>
            <TableCell @click.stop>
              <div class="flex justify-end gap-2">
                <Button size="sm" variant="outline">Edit</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  class="text-destructive"
                  :disabled="user.role === 'owner'"
                  @click="onRemove(user)"
                >
                  Remove
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      No users.
    </div>
  </div>
</template>
