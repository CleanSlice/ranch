<script setup lang="ts">
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui';
import { compareText } from '#common/utils/format';
import {
  AgentAccessRefusalCodes,
  asAgentAccessRefusal,
} from '#agentAccess/domain';
import {
  CONFIRM_OPEN_TEXT,
  OUTSIDE_VIEW_TEXT,
  REVIEW_TEXT,
  accessManagement,
  applyChoices,
  changedAgents,
  choiceOf,
  filterByName,
  managedByLine,
  outcomeSentence,
  predictOutcome,
  type AccessChoice,
  type IAccessOutcome,
} from '#agentAccess/utils/outcome';
import {
  listedAgents,
  searchNamesAssistant,
} from '#agentAccess/utils/assistantRow';

/**
 * Which agents one account reaches, and the three-way choice that changes it
 * (CLEAN-231, spec 032, contracts/console.md).
 *
 * The rows are the agents the signed-in viewer reaches: the agent store
 * holds nothing else, so an Admin is offered only what is theirs to give.
 * The record lives in the agentAccess store; the only thing kept here is
 * what the person has chosen and not saved yet, which is a form, not a copy.
 * Every rule (who may edit whom, the ceiling, the confirmation, a stale
 * version) is the server's: its refusal is shown as received.
 */
const props = defineProps<{ userId: string }>();

const auth = useAuthStore();
const userStore = useUserStore();
const agentStore = useAgentStore();
const accessStore = useAgentAccessStore();

const target = computed(() => userStore.byId(props.userId));
const management = computed(() =>
  target.value ? accessManagement(auth.user, target.value) : 'none',
);
const editable = computed(() => management.value === 'editable');
/**
 * Whether the assistant block is shown at all. The API reads an account's
 * assistant setting to the Owner for any account, and to an Admin for the
 * Users they may edit (403 otherwise). Known before any request, like the
 * rest of this card, so none is sent that would be refused: the block used
 * to ask for the Admin's own account and the Owner's and swallow the 403.
 */
const showsAssistant = computed(
  () => editable.value || auth.user?.role === 'Owner',
);

interface IShownError {
  code: string | null;
  message: string;
}

function shownError(err: unknown): IShownError {
  const refusal = asAgentAccessRefusal(err);
  if (refusal) return { code: refusal.code, message: refusal.message };
  return {
    code: null,
    message: err instanceof Error && err.message ? err.message : 'Something went wrong.',
  };
}

// Loading state from the request, content from the stores. Nothing is asked
// for an account whose access the viewer may not edit: the API would refuse.
const loadError = ref<IShownError | null>(null);
const { pending: loading } = useAsyncData(
  `admin-user-access-${props.userId}`,
  async () => {
    if (!editable.value) return false;
    loadError.value = null;
    try {
      await Promise.all([
        agentStore.fetchAll(),
        accessStore.fetchById(props.userId),
      ]);
    } catch (err) {
      loadError.value = shownError(err);
    }
    return true;
  },
  { watch: [editable] },
);

const access = computed(() => accessStore.byId(props.userId));

// What the person chose and has not saved: agent id → choice.
const pending = ref<Record<string, AccessChoice>>({});

// The assistant is not one of the agents these lists are about (CLEAN-240):
// who has it is set in the block above them, and the API refuses its id here.
const agents = computed(() =>
  listedAgents(agentStore.agents).sort((a, b) => compareText(a.name, b.name)),
);
const search = ref('');
const rows = computed(() => filterByName(agents.value, search.value));
const searchedAssistant = computed(() =>
  searchNamesAssistant(agentStore.agents, search.value),
);

function choiceFor(agentId: string): AccessChoice {
  const chosen = pending.value[agentId];
  if (chosen) return chosen;
  return access.value ? choiceOf(agentId, access.value) : 'none';
}

const changed = computed(() =>
  access.value ? changedAgents(access.value, pending.value) : [],
);
const dirty = computed(() => changed.value.length > 0);
const desired = computed(() =>
  applyChoices(access.value ?? { allowed: [], denied: [] }, pending.value),
);
const prediction = computed(() =>
  access.value ? predictOutcome(access.value, desired.value) : null,
);
const outcome = computed<IAccessOutcome | null>(() => {
  if (!access.value) return null;
  return dirty.value && prediction.value
    ? prediction.value.outcome
    : access.value.outcome;
});

const saving = ref(false);
const saveError = ref<IShownError | null>(null);
// Set when ACCESS_CHANGED made the editor read the access again.
const reloaded = ref(false);

function choose(agentId: string, choice: AccessChoice) {
  const next = { ...pending.value };
  const stored = access.value ? choiceOf(agentId, access.value) : 'none';
  if (choice === stored) delete next[agentId];
  else next[agentId] = choice;
  pending.value = next;
  saveError.value = null;
  reloaded.value = false;
}

function discard() {
  pending.value = {};
  saveError.value = null;
  reloaded.value = false;
}

// The confirmation before a limited account becomes an open one (FR-021).
// It opens before the request when the editor can already tell, and on
// ACCESS_OPEN_NEEDS_CONFIRM when only the server could.
const confirmOpen = ref(false);
const confirmMessage = ref(CONFIRM_OPEN_TEXT);
const confirmOutcome = ref<IAccessOutcome | null>(null);

function askToOpen(message: string, result: IAccessOutcome | null) {
  confirmMessage.value = message;
  confirmOutcome.value = result;
  confirmOpen.value = true;
}

async function save(confirmed = false) {
  const current = access.value;
  if (!current || saving.value) return;
  const next = prediction.value;
  if (!confirmed && next?.opens && next.certain) {
    askToOpen(CONFIRM_OPEN_TEXT, next.outcome);
    return;
  }
  saving.value = true;
  saveError.value = null;
  reloaded.value = false;
  try {
    await accessStore.save(props.userId, {
      ...desired.value,
      version: current.version,
      confirmOpen: confirmed,
    });
    pending.value = {};
  } catch (err) {
    const refusal = asAgentAccessRefusal(err);
    if (refusal?.code === AgentAccessRefusalCodes.OpenNeedsConfirm && !confirmed) {
      askToOpen(refusal.message, refusal.outcome);
    } else {
      saveError.value = shownError(err);
      if (refusal?.code === AgentAccessRefusalCodes.Changed) {
        await reloadAfterChange();
      } else if (refusal && refusal.code === null && refusal.status === 404) {
        // An agent or the account is gone: the rows are out of date.
        await reloadQuietly();
      }
    }
  } finally {
    saving.value = false;
  }
}

// Somebody else saved first. The lists are read again; what the person
// chose stays selected on top of them, so nothing they did is lost and
// nothing is saved over the other change unseen.
async function reloadAfterChange() {
  try {
    await accessStore.fetchById(props.userId);
    reloaded.value = true;
  } catch (err) {
    loadError.value = shownError(err);
  }
}

async function reloadQuietly() {
  await Promise.allSettled([
    agentStore.fetchAll(),
    accessStore.fetchById(props.userId),
  ]);
}

function onConfirm() {
  confirmOpen.value = false;
  void save(true);
}
</script>

<template>
  <Card data-access-card>
    <CardHeader>
      <CardTitle>Agent access</CardTitle>
      <CardDescription>Which agents this account can use.</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <AssistantAccessAccountRow
        v-if="target && showsAssistant"
        :user-id="userId"
        :name="target.name || target.email"
      />

      <p
        v-if="!editable"
        class="text-sm text-muted-foreground"
        :data-access-managed="management"
      >
        {{ managedByLine(management) }}
      </p>

      <div v-else-if="!access && loading" class="text-sm text-muted-foreground">
        Loading access…
      </div>

      <p
        v-else-if="!access"
        class="text-sm text-destructive"
        :data-access-error="loadError?.code ?? 'error'"
      >
        {{ loadError?.message ?? 'Agent access could not be read.' }}
      </p>

      <div v-else class="flex flex-col gap-4">
        <div
          v-if="access.needsReview"
          class="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:text-amber-200"
          data-access-review
        >
          <span>{{ REVIEW_TEXT }}</span>
          <Button
            v-if="!dirty"
            size="sm"
            variant="outline"
            class="shrink-0"
            :disabled="saving"
            data-access-open
            @click="save()"
          >
            Reach every agent
          </Button>
        </div>

        <AgentAccessOutcome v-if="outcome" :outcome="outcome" :pending="dirty" />

        <p
          v-if="access.hasEntriesOutsideView"
          class="text-xs text-muted-foreground"
          data-access-outside
        >
          {{ OUTSIDE_VIEW_TEXT }}
        </p>

        <Input
          v-if="agents.length > 6"
          v-model="search"
          placeholder="Filter agents by name"
          data-access-search
        />

        <div
          v-if="agents.length"
          class="flex max-h-[28rem] flex-col gap-0.5 overflow-auto rounded-md border p-1"
          data-access-rows
        >
          <AgentAccessRow
            v-for="agent in rows"
            :key="agent.id"
            :agent="agent"
            :choice="choiceFor(agent.id)"
            :changed="changed.includes(agent.id)"
            :disabled="saving"
            @choose="(choice: AccessChoice) => choose(agent.id, choice)"
          />
          <p
            v-if="!rows.length"
            class="p-2 text-center text-xs text-muted-foreground"
          >
            <template v-if="searchedAssistant">The assistant is set above.</template>
            <template v-else>No agent matches “{{ search.trim() }}”.</template>
          </p>
        </div>
        <p
          v-else
          class="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground"
          data-access-empty
        >
          There are no agents you can give or take here.
        </p>

        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-3">
            <Button :disabled="!dirty || saving" data-access-save @click="save()">
              {{ saving ? 'Saving…' : 'Save access' }}
            </Button>
            <Button
              v-if="dirty"
              variant="ghost"
              :disabled="saving"
              data-access-discard
              @click="discard"
            >
              Discard
            </Button>
          </div>
          <p
            v-if="saveError"
            class="text-sm text-destructive"
            role="alert"
            :data-access-error="saveError.code ?? 'error'"
          >
            {{ saveError.message }}
          </p>
          <p v-if="reloaded" class="text-xs text-muted-foreground" data-access-reloaded>
            Someone else changed this access. The rows now show the current
            lists, with your choices still selected. Save again to apply them.
          </p>
        </div>
      </div>
    </CardContent>

    <AlertDialogRoot v-model:open="confirmOpen">
      <AlertDialogPortal>
        <AlertDialogOverlay
          class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80"
        />
        <AlertDialogContent
          data-access-confirm
          class="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6 shadow-lg duration-200"
        >
          <div class="flex flex-col gap-2 text-center sm:text-left">
            <AlertDialogTitle class="text-foreground text-lg font-semibold">
              Open this account to every agent?
            </AlertDialogTitle>
            <AlertDialogDescription class="text-muted-foreground text-sm">
              {{ confirmMessage }}
            </AlertDialogDescription>
            <p v-if="confirmOutcome" class="text-sm font-medium" data-access-confirm-outcome>
              {{ outcomeSentence(confirmOutcome) }}
            </p>
          </div>
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" data-access-confirm-cancel @click="confirmOpen = false">
              Cancel
            </Button>
            <Button data-access-confirm-accept @click="onConfirm">
              Save and open
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogRoot>
  </Card>
</template>
