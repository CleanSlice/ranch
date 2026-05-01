<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Checkbox } from '#theme/components/ui/checkbox';
import { Label } from '#theme/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';

const settingStore = useSettingStore();
await useAsyncData('admin-settings-auth', () => settingStore.fetchAll());

const SETTING_GROUP = 'auth';
const SETTING_KEY = 'registration_enabled';

function loadInitial(): boolean {
  const v = settingStore.get(SETTING_GROUP, SETTING_KEY)?.value;
  return v === true || v === 'true';
}

const registrationEnabled = ref<boolean>(loadInitial());
const saving = ref(false);
const savedAt = ref<string | null>(null);
const errorMessage = ref<string | null>(null);

async function onSave() {
  saving.value = true;
  errorMessage.value = null;
  try {
    await settingStore.upsert(
      SETTING_GROUP,
      SETTING_KEY,
      registrationEnabled.value ? 'true' : 'false',
      'string',
    );
    savedAt.value = new Date().toLocaleTimeString();
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <Card>
      <CardHeader>
        <CardTitle>Authentication</CardTitle>
        <CardDescription>
          Controls who can sign in and create accounts on the public app.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid max-w-xl gap-4">
        <label class="flex items-start gap-3" for="auth-registration">
          <Checkbox
            id="auth-registration"
            :model-value="registrationEnabled"
            @update:model-value="(v: boolean | 'indeterminate') => (registrationEnabled = v === true)"
          />
          <div class="grid gap-1">
            <Label for="auth-registration" class="cursor-pointer">
              Allow self-service registration
            </Label>
            <p class="text-xs text-muted-foreground">
              When enabled, anyone can create a User account via the
              <code>/register</code> page. New accounts get the
              <code>User</code> role by default — promote to Admin/Owner here
              afterwards.
            </p>
            <p class="text-xs text-muted-foreground/70">auth/registration_enabled</p>
          </div>
        </label>
      </CardContent>
    </Card>

    <div class="flex items-center gap-3">
      <Button :disabled="saving" @click="onSave">
        {{ saving ? 'Saving…' : 'Save changes' }}
      </Button>
      <span v-if="savedAt" class="text-xs text-muted-foreground">
        Saved at {{ savedAt }}
      </span>
      <span v-if="errorMessage" class="text-xs text-destructive">
        {{ errorMessage }}
      </span>
    </div>
  </div>
</template>
