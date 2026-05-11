<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';

const authStore = useAuthStore();

async function onLogout() {
  authStore.logout();
  await navigateTo('/login');
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background p-6">
    <Card class="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Access denied</CardTitle>
        <CardDescription>
          Your account does not have permission to access the admin panel.
          Please contact administration to request Owner or Admin access.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid gap-3">
          <p v-if="authStore.user?.email" class="text-xs text-muted-foreground">
            Signed in as <span class="font-medium">{{ authStore.user.email }}</span>
          </p>
          <Button variant="outline" class="w-full" @click="onLogout">
            Sign out
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
