<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import type {
  IIntegrationAccountData,
  IIntegrationCatalogueItem,
  ILoginInstructionData,
} from '#integration/stores/integration';
import IntegrationCatalogue from './Catalogue.vue';
import IntegrationConnectedList from './ConnectedList.vue';
import IntegrationInstallPanel from './InstallPanel.vue';
import IntegrationConnectDialog from './ConnectDialog.vue';
import IntegrationSecretDialog from './SecretDialog.vue';
import IntegrationLoginDialog from './LoginDialog.vue';
import IntegrationImportCookiesDialog from './ImportCookiesDialog.vue';
import IntegrationAliasesDialog from './AliasesDialog.vue';

const store = useIntegrationStore();

const { pending: catalogueLoading } = await useAsyncData(
  'admin-integrations-catalogue',
  () => store.fetchCatalogue(),
);

const {
  data: items,
  pending: listLoading,
  refresh,
} = await useAsyncData('admin-integrations-list', () => store.fetchAll());

// Light polling so status changes (browser-side login completes, profile
// expires) show up without manual refresh. Dialogs do tighter per-item
// polling — this just keeps the table fresh.
const pollHandle = ref<ReturnType<typeof setInterval> | null>(null);
function startPolling() {
  if (pollHandle.value) return;
  pollHandle.value = setInterval(() => refresh(), 8000);
}
function stopPolling() {
  if (pollHandle.value) {
    clearInterval(pollHandle.value);
    pollHandle.value = null;
  }
}
onMounted(startPolling);
onUnmounted(stopPolling);

// Dialog state — at most one open at a time.
const connectTarget = ref<IIntegrationCatalogueItem | null>(null);
const secretTarget = ref<IIntegrationAccountData | null>(null);
const loginTarget = ref<{
  account: IIntegrationAccountData;
  connection: ILoginInstructionData;
} | null>(null);
const importCookiesTarget = ref<IIntegrationAccountData | null>(null);
const aliasesTarget = ref<IIntegrationAccountData | null>(null);
const pendingRemoval = ref<IIntegrationAccountData | null>(null);

const confirmRemoveOpen = computed({
  get: () => pendingRemoval.value !== null,
  set: (v: boolean) => {
    if (!v) pendingRemoval.value = null;
  },
});

async function onPickCatalogueItem(item: IIntegrationCatalogueItem) {
  connectTarget.value = item;
}

async function onConnected(payload: {
  account: IIntegrationAccountData;
  flow: 'vnc' | 'cookies' | 'auto';
}) {
  connectTarget.value = null;
  await refresh();
  // Auto-route the user to the next step that's appropriate for the
  // mechanism so they don't have to hunt for a second button.
  const { account, flow } = payload;
  if (account.mechanism === 'browser') {
    if (flow === 'cookies') {
      importCookiesTarget.value = account;
    } else {
      const conn = await store.openLogin(account.id);
      if (conn) loginTarget.value = { account, connection: conn };
    }
  } else {
    secretTarget.value = account;
  }
}

async function onLogin(account: IIntegrationAccountData) {
  const conn = await store.openLogin(account.id);
  if (conn) loginTarget.value = { account, connection: conn };
}

async function onSecret(account: IIntegrationAccountData) {
  secretTarget.value = account;
}

async function onSecretSaved() {
  secretTarget.value = null;
  await refresh();
}

async function onImportCookies(account: IIntegrationAccountData) {
  importCookiesTarget.value = account;
}

async function onCookiesSaved() {
  importCookiesTarget.value = null;
  await refresh();
}

async function onAliases(account: IIntegrationAccountData) {
  aliasesTarget.value = account;
}

async function onAliasesSaved() {
  aliasesTarget.value = null;
  await refresh();
}

async function onLoginClosed(needsRefresh: boolean) {
  loginTarget.value = null;
  if (needsRefresh) await refresh();
}

async function onRemove() {
  const item = pendingRemoval.value;
  if (!item) return;
  pendingRemoval.value = null;
  await store.disconnect(item.id);
  await refresh();
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <div>
      <h1 class="text-2xl font-semibold">Integrations</h1>
      <p class="text-sm text-muted-foreground">
        Connect external services so your agents can act on your behalf —
        Instagram and other social networks run through a logged-in browser
        in the cluster; API-style services (OpenAI, GitHub, Stripe) store
        their token in your per-user secret vault.
      </p>
    </div>

    <IntegrationInstallPanel />

    <section class="flex flex-col gap-3">
      <h2 class="text-lg font-medium">Available services</h2>
      <p v-if="catalogueLoading" class="text-sm text-muted-foreground">
        Loading catalogue…
      </p>
      <IntegrationCatalogue
        v-else
        :items="store.catalogue"
        :connected="items ?? []"
        @pick="onPickCatalogueItem"
      />
    </section>

    <section class="flex flex-col gap-3">
      <h2 class="text-lg font-medium">Connected</h2>
      <p v-if="listLoading" class="text-sm text-muted-foreground">Loading…</p>
      <IntegrationConnectedList
        v-else
        :items="items ?? []"
        :catalogue="store.catalogue"
        @login="onLogin"
        @secret="onSecret"
        @import-cookies="onImportCookies"
        @aliases="onAliases"
        @remove="(item) => (pendingRemoval = item)"
      />
    </section>

    <IntegrationConnectDialog
      :item="connectTarget"
      @close="connectTarget = null"
      @connected="onConnected"
    />

    <IntegrationSecretDialog
      :account="secretTarget"
      :catalogue="store.catalogue"
      @close="secretTarget = null"
      @saved="onSecretSaved"
    />

    <IntegrationLoginDialog
      :payload="loginTarget"
      :catalogue="store.catalogue"
      @close="onLoginClosed"
    />

    <IntegrationImportCookiesDialog
      :account="importCookiesTarget"
      :catalogue="store.catalogue"
      @close="importCookiesTarget = null"
      @saved="onCookiesSaved"
    />

    <IntegrationAliasesDialog
      :account="aliasesTarget"
      :catalogue="store.catalogue"
      @close="aliasesTarget = null"
      @saved="onAliasesSaved"
    />

    <ConfirmDialog
      v-model:open="confirmRemoveOpen"
      title="Disconnect integration"
      :description="
        pendingRemoval
          ? `Disconnect ${pendingRemoval.service} (“${pendingRemoval.accountKey}”)? All stored credentials for this account will be wiped — the agent will lose access until you reconnect.`
          : ''
      "
      confirm-label="Disconnect"
      @confirm="onRemove"
    />
  </div>
</template>
