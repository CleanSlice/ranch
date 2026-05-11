<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import {
  ApiKeyScopeTypes,
  type ICreatedApiKey,
  type IApiKeyData,
} from '#apiKey/stores/apiKey';
import ApiKeyList from './List.vue';
import ApiKeyCreateDialog from './CreateDialog.vue';
import ApiKeyCreatedKeyDisplay from './CreatedKeyDisplay.vue';

const store = useApiKeyStore();

const { data: items, pending, refresh } = await useAsyncData(
  'admin-api-keys',
  () => store.fetchAll(),
);

const createOpen = ref(false);
const justCreated = ref<ICreatedApiKey | null>(null);

async function onCreated(created: ICreatedApiKey) {
  createOpen.value = false;
  justCreated.value = created;
  await refresh();
}

const pendingRemoval = ref<IApiKeyData | null>(null);
const confirmRemoveOpen = computed({
  get: () => pendingRemoval.value !== null,
  set: (v: boolean) => {
    if (!v) pendingRemoval.value = null;
  },
});

async function onRemove() {
  const item = pendingRemoval.value;
  if (!item) return;
  pendingRemoval.value = null;
  await store.remove(item.id);
  await refresh();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">API Keys</h1>
        <p class="text-sm text-muted-foreground">
          Long-lived keys for 3rd-party backends. Pair with a scope (e.g.
          <code class="rounded bg-muted px-1 py-0.5 text-xs">embed:mint</code>) so each key can only do what it needs to.
        </p>
      </div>
      <Button @click="createOpen = true">New API key</Button>
    </div>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <ApiKeyList
      v-else
      :items="items ?? []"
      @remove="(item) => (pendingRemoval = item)"
    />

    <ApiKeyCreateDialog v-model:open="createOpen" @created="onCreated" />

    <ApiKeyCreatedKeyDisplay
      :created="justCreated"
      @close="justCreated = null"
    />

    <ConfirmDialog
      v-model:open="confirmRemoveOpen"
      title="Revoke API key"
      :description="
        pendingRemoval
          ? `Revoke “${pendingRemoval.name}”? Any service calling Ranch with this key will be denied immediately. Cannot be undone.`
          : ''
      "
      confirm-label="Revoke key"
      @confirm="onRemove"
    />
  </div>
</template>
