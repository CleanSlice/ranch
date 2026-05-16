<script setup lang="ts">
import {
  type IBrowserSessionConnectionData,
  BrowserSessionStatusTypes,
} from '#browser/stores/browser';
import { Button } from '#theme/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#theme/components/ui/dialog';

const props = defineProps<{
  connection: IBrowserSessionConnectionData | null;
}>();

const emit = defineEmits<{
  (event: 'close', needsRefresh: boolean): void;
}>();

const store = useBrowserStore();

const open = computed({
  get: () => props.connection !== null,
  set: (v: boolean) => {
    if (!v) emit('close', didChange.value);
  },
});

const didChange = ref(false);
const status = ref<BrowserSessionStatusTypes | null>(null);
const pollHandle = ref<ReturnType<typeof setInterval> | null>(null);

// Watch the session status while the dialog is open — once the user
// finishes login in the embedded VNC, status flips idle and we close
// the dialog automatically. 3s is tight enough that "I'm done" doesn't
// linger awkwardly.
watch(
  () => props.connection,
  (conn) => {
    if (pollHandle.value) {
      clearInterval(pollHandle.value);
      pollHandle.value = null;
    }
    didChange.value = false;
    status.value = conn?.session.status ?? null;
    if (!conn) return;
    pollHandle.value = setInterval(async () => {
      const fresh = await store.refreshOne(conn.session.id);
      if (!fresh) return;
      status.value = fresh.status;
      if (fresh.status === BrowserSessionStatusTypes.Idle ||
          fresh.status === BrowserSessionStatusTypes.Active) {
        didChange.value = true;
        emit('close', true);
      }
    }, 3000);
  },
  { immediate: true },
);

onUnmounted(() => {
  if (pollHandle.value) clearInterval(pollHandle.value);
});

function onManualDone() {
  didChange.value = true;
  emit('close', true);
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-3xl">
      <DialogHeader>
        <DialogTitle>
          Log in to {{ connection?.session.accountKey }}
        </DialogTitle>
        <DialogDescription>
          Sign in to the live browser below so the agent can resume working
          on this account. Cookies stay encrypted on the server — your
          password never leaves this window.
        </DialogDescription>
      </DialogHeader>

      <div v-if="connection?.vncUrl" class="overflow-hidden rounded-md border bg-black">
        <iframe
          :src="connection.vncUrl"
          class="block h-[480px] w-full"
          sandbox="allow-scripts allow-forms allow-same-origin"
          referrerpolicy="no-referrer"
        />
      </div>
      <div v-else class="rounded-md border border-dashed bg-card/50 p-6 text-center">
        <p class="text-sm text-muted-foreground">
          Browser pool isn’t configured — no VNC URL available for this
          session.
        </p>
      </div>

      <div class="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Status:
          <strong>{{ status ?? 'unknown' }}</strong>
        </span>
        <span v-if="pollHandle">Checking every 3s…</span>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="emit('close', didChange)">
          Close
        </Button>
        <Button @click="onManualDone">I’m done</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
