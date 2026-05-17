<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import {
  type IBrowserSessionData,
  type IBrowserSessionConnectionData,
} from '#browser/stores/browser';
import BrowserList from './List.vue';
import BrowserLoginDialog from './LoginDialog.vue';
import BrowserAddDialog from './AddDialog.vue';
import BrowserExtensionPanel from './ExtensionPanel.vue';

const store = useBrowserStore();
const route = useRoute();

const {
  data: items,
  pending,
  refresh,
} = await useAsyncData('admin-browser-sessions', () => store.fetchAll());

// Light polling so login completions show up without a refresh. Pauses
// while a dialog is open (the dialog drives its own session-specific
// polling at a higher frequency).
const pollHandle = ref<ReturnType<typeof setInterval> | null>(null);
function startPolling() {
  if (pollHandle.value) return;
  pollHandle.value = setInterval(() => refresh(), 5000);
}
function stopPolling() {
  if (pollHandle.value) {
    clearInterval(pollHandle.value);
    pollHandle.value = null;
  }
}
onMounted(startPolling);
onUnmounted(stopPolling);

const addOpen = ref(false);
const loginSession = ref<IBrowserSessionConnectionData | null>(null);

// Deeplink: /browser?login=instagram:miybot opens straight into the login
// dialog so the agent's Telegram message ("open this link to log in") is
// one click.
onMounted(async () => {
  const login = route.query.login as string | undefined;
  if (!login) return;
  const conn = await store.open(login);
  if (conn) loginSession.value = conn;
});

const pendingRemoval = ref<IBrowserSessionData | null>(null);
const confirmRemoveOpen = computed({
  get: () => pendingRemoval.value !== null,
  set: (v: boolean) => {
    if (!v) pendingRemoval.value = null;
  },
});

async function onLogin(item: IBrowserSessionData) {
  const conn = await store.open(item.accountKey);
  if (conn) loginSession.value = conn;
}

async function onReset(item: IBrowserSessionData) {
  await store.reset(item.id);
  await refresh();
}

async function onRemove() {
  const item = pendingRemoval.value;
  if (!item) return;
  pendingRemoval.value = null;
  await store.remove(item.id);
  await refresh();
}

async function onAdded(conn: IBrowserSessionConnectionData) {
  addOpen.value = false;
  loginSession.value = conn;
  await refresh();
}

async function onLoginClosed(needsRefresh: boolean) {
  loginSession.value = null;
  if (needsRefresh) await refresh();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Browser sessions</h1>
        <p class="text-sm text-muted-foreground">
          Persistent logged-in browsers your agents drive on your behalf —
          Instagram, PayPal, ad managers, etc. Cookies stay encrypted in
          the cluster, never copied to the agent.
        </p>
      </div>
      <Button @click="addOpen = true">Add account</Button>
    </div>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <BrowserList
      v-else
      :items="items ?? []"
      @login="onLogin"
      @reset="onReset"
      @remove="(item) => (pendingRemoval = item)"
    />

    <BrowserExtensionPanel />

    <BrowserAddDialog v-model:open="addOpen" @added="onAdded" />

    <BrowserLoginDialog
      :connection="loginSession"
      @close="onLoginClosed"
    />

    <ConfirmDialog
      v-model:open="confirmRemoveOpen"
      title="Disconnect account"
      :description="
        pendingRemoval
          ? `Disconnect “${pendingRemoval.accountKey}”? All cookies and login state for this account will be wiped. The agent will need a fresh login to use it again.`
          : ''
      "
      confirm-label="Disconnect"
      @confirm="onRemove"
    />
  </div>
</template>
