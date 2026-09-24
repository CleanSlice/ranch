<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { IconCheck, IconChevronDown, IconSearch } from '@tabler/icons-vue';
import { toast } from 'vue-sonner';
import { AGENT_STATUS_VARIANT } from '#agent/utils/agentFormat';
import type { AgentStatusTypes } from '#agent/domain';
import {
  usePeerStore,
  type IAgentCard,
  type IAgentPeerCandidate,
} from '#peer/stores/peer';

/* IAgentCard is also the shape previewByUrl returns — one preview, two
 * sources (CLEAN-95). */

/**
 * Pick an agent, read its card, then connect (CLEAN-74, CLEAN-94).
 *
 * The preview step is the point of this component. Connecting a peer decides
 * what another agent will be told it can ask for, so the operator sees the
 * exact text first — a name alone would make "why did it pick the wrong one"
 * unanswerable later.
 *
 * The preview expands under the clicked row, accordion-style: at ten
 * candidates a panel below the list sits under the fold, and a click that
 * renders off-screen reads as a click that did nothing (CLEAN-94).
 *
 * The two ways in — an agent of this ranch, or any A2A address — are tabs, not
 * one scrolling column (CLEAN-98). Stacked, the address form sat below every
 * candidate: on a ranch with a dozen agents nothing on the first screen said an
 * external import existed at all.
 */
const props = defineProps<{ open: boolean; agentId: string }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; connected: [] }>();

const store = usePeerStore();

const filter = ref('');
const selected = ref<IAgentPeerCandidate | null>(null);
const preview = ref<IAgentCard | null>(null);
const previewing = ref(false);
const connecting = ref(false);
const error = ref<string | null>(null);

const FILTER_FROM = 6;

type AddMode = 'ranch' | 'external' | 'card';

const MODES: readonly AddMode[] = ['ranch', 'external', 'card'];

const mode = ref<AddMode>('ranch');
/** True once the operator has picked a tab themselves; after that nothing
 *  moves them, least of all the empty-ranch default below. */
const modeTouched = ref(false);

function selectMode(value: unknown): void {
  if (!MODES.includes(value as AddMode)) return;
  mode.value = value as AddMode;
  modeTouched.value = true;
}

const candidates = computed(() => store.candidates(props.agentId));
/** What the tab counts: agents that can still be added, not the whole ranch. */
const available = computed(
  () => candidates.value.filter((c) => !c.connected).length,
);

const visible = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return candidates.value;
  return candidates.value.filter((c) => c.name.toLowerCase().includes(q));
});

const isOpen = computed({
  get: () => props.open,
  set: (v: boolean) => emit('update:open', v),
});

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    filter.value = '';
    selected.value = null;
    preview.value = null;
    error.value = null;
    url.value = '';
    urlToken.value = '';
    urlPreview.value = null;
    urlError.value = null;
    cardText.value = '';
    cardToken.value = '';
    cardPreview.value = null;
    cardError.value = null;
    cardFileName.value = null;
    mode.value = 'ranch';
    modeTouched.value = false;
    await store.loadCandidates(props.agentId);
    // With nothing left to connect on this ranch, the address form IS the
    // dialog — opening on an empty list would read as "no way to add a peer".
    if (!modeTouched.value && candidates.value.length === 0) {
      mode.value = 'external';
    }
  },
);

async function toggle(candidate: IAgentPeerCandidate) {
  if (candidate.connected || connecting.value) return;
  if (selected.value?.id === candidate.id) {
    selected.value = null;
    preview.value = null;
    error.value = null;
    return;
  }
  selected.value = candidate;
  preview.value = null;
  error.value = null;
  previewing.value = true;
  try {
    preview.value = await store.previewCard(candidate.id);
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : 'Could not read that agent card';
  } finally {
    previewing.value = false;
  }
}

async function connect() {
  if (!selected.value) return;
  connecting.value = true;
  error.value = null;
  try {
    await store.connect(props.agentId, selected.value.id);
    toast.success(`«${selected.value.name}» connected — card read`);
    emit('connected');
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : 'Could not connect that peer';
  } finally {
    connecting.value = false;
  }
}

// ── Import an external agent by address (CLEAN-95) ──────────────
const url = ref('');
const urlToken = ref('');
const urlPreview = ref<IAgentCard | null>(null);
const urlPreviewing = ref(false);
const urlImporting = ref(false);
const urlError = ref<string | null>(null);

// A changed address invalidates the card already shown for the old one.
watch(url, () => {
  urlPreview.value = null;
  urlError.value = null;
});

async function previewUrl() {
  if (!url.value.trim()) return;
  urlPreviewing.value = true;
  urlError.value = null;
  urlPreview.value = null;
  try {
    urlPreview.value = await store.previewByUrl(
      props.agentId,
      url.value.trim(),
      urlToken.value.trim() || undefined,
    );
  } catch (err) {
    urlError.value =
      err instanceof Error ? err.message : 'Could not read that address';
  } finally {
    urlPreviewing.value = false;
  }
}

async function importUrl() {
  if (!urlPreview.value) return;
  urlImporting.value = true;
  urlError.value = null;
  try {
    const imported = await store.importByUrl(
      props.agentId,
      url.value.trim(),
      urlToken.value.trim() || undefined,
    );
    toast.success(`«${imported.peerName}» connected — card read`);
    emit('connected');
  } catch (err) {
    urlError.value =
      err instanceof Error ? err.message : 'Could not import that agent';
  } finally {
    urlImporting.value = false;
  }
}

// ── Connect from a card in hand (CLEAN-116) ─────────────────────
// Same two steps as the address path — read, then connect — because what is
// being approved is the same thing: the text a delegating model will read.
const cardText = ref('');
const cardToken = ref('');
const cardPreview = ref<IAgentCard | null>(null);
const cardPreviewing = ref(false);
const cardImporting = ref(false);
const cardError = ref<string | null>(null);
const cardFileName = ref<string | null>(null);

watch(cardText, () => {
  cardPreview.value = null;
  cardError.value = null;
});

/** The file never leaves the browser: it is read here and sent as text, so
 *  the API keeps one way in and one set of checks. */
async function onCardFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    cardText.value = await file.text();
    cardFileName.value = file.name;
  } catch {
    cardError.value = 'Could not read that file';
  } finally {
    // Let the same file be picked again after an edit.
    input.value = '';
  }
}

async function previewPastedCard() {
  if (!cardText.value.trim()) return;
  cardPreviewing.value = true;
  cardError.value = null;
  cardPreview.value = null;
  try {
    cardPreview.value = await store.previewPastedCard(
      props.agentId,
      cardText.value,
    );
  } catch (err) {
    cardError.value =
      err instanceof Error ? err.message : 'Could not read that card';
  } finally {
    cardPreviewing.value = false;
  }
}

async function importCard() {
  if (!cardPreview.value) return;
  cardImporting.value = true;
  cardError.value = null;
  try {
    const imported = await store.importByCard(
      props.agentId,
      cardText.value,
      cardToken.value.trim() || undefined,
    );
    toast.success(`«${imported.peerName}» connected — card read`);
    emit('connected');
  } catch (err) {
    cardError.value =
      err instanceof Error ? err.message : 'Could not connect that agent';
  } finally {
    cardImporting.value = false;
  }
}

function statusVariant(status: string) {
  return AGENT_STATUS_VARIANT[status as AgentStatusTypes] ?? 'outline';
}

/**
 * The moment of maximum leverage for an empty card is BEFORE Connect: the
 * operator is looking at exactly the text the delegating model will read,
 * and can still fix the agent first (CLEAN-95). Connecting stays allowed —
 * sometimes the card fills up later — but never unknowingly.
 */
const previewAdvertisesNothing = computed(
  () => Boolean(preview.value) && preview.value!.skills.length === 0,
);
const urlPreviewAdvertisesNothing = computed(
  () => Boolean(urlPreview.value) && urlPreview.value!.skills.length === 0,
);
const cardPreviewAdvertisesNothing = computed(
  () => Boolean(cardPreview.value) && cardPreview.value!.skills.length === 0,
);
</script>

<template>
  <DialogRoot v-model:open="isOpen">
    <DialogPortal>
      <DialogOverlay
        class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50"
      />
      <DialogContent
        class="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border p-6 shadow-lg duration-200"
      >
        <DialogTitle class="text-lg font-bold tracking-tight">
          Add peer
        </DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted-foreground">
          <template v-if="mode === 'ranch'">
            Agents on this ranch this one isn't connected to yet. Click an agent
            to read its card, then connect.
          </template>
          <template v-else-if="mode === 'external'">
            Any A2A agent outside this ranch, by its address. Importing the
            same address again updates the entry — no duplicates.
          </template>
          <template v-else>
            For an agent whose card is not published anywhere: paste it, or
            pick the file. The address inside the card is what delegations
            will call.
          </template>
        </DialogDescription>

        <Tabs
          :model-value="mode"
          class="mt-3.5 flex min-h-0 flex-1 flex-col gap-3.5"
          @update:model-value="selectMode"
        >
          <TabsList class="grid w-full grid-cols-3">
            <TabsTrigger value="ranch">
              On this ranch
              <span v-if="available" class="opacity-60">{{ available }}</span>
            </TabsTrigger>
            <TabsTrigger value="external">By address</TabsTrigger>
            <TabsTrigger value="card">From a card</TabsTrigger>
          </TabsList>

          <div class="min-h-0 flex-1 overflow-y-auto">
            <TabsContent value="ranch" class="flex flex-col gap-3.5">
              <div v-if="candidates.length >= FILTER_FROM" class="relative">
                <IconSearch
                  class="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  v-model="filter"
                  placeholder="Filter agents"
                  class="pl-8"
                  autocomplete="off"
                />
              </div>

              <ul v-if="visible.length" class="flex flex-col">
                <li
                  v-for="candidate in visible"
                  :key="candidate.id"
                  class="border-t first:border-t-0"
                >
                  <button
                    type="button"
                    class="flex w-full items-center justify-between gap-3 px-1 py-3 text-left text-sm transition-colors"
                    :class="[
                      candidate.connected
                        ? 'cursor-default text-muted-foreground'
                        : 'hover:bg-muted/60',
                      selected?.id === candidate.id ? 'bg-muted/60' : '',
                    ]"
                    :disabled="candidate.connected"
                    @click="toggle(candidate)"
                  >
                    <span class="min-w-0 truncate font-semibold">
                      {{ candidate.name }}
                    </span>
                    <!-- Status rides with the Info chip on the right edge
                         (CLEAN-98): beside the name it sat at a different
                         distance in every row, so nothing lined up. -->
                    <span class="flex shrink-0 items-center gap-2">
                      <Badge :variant="statusVariant(candidate.status)">
                        {{ candidate.status }}
                      </Badge>
                      <span
                        v-if="candidate.connected"
                        class="flex items-center gap-1 text-xs"
                      >
                        <IconCheck class="size-3.5" />
                        connected
                      </span>
                      <!-- The affordance the row was missing: says what a click
                           does, and doubles as the open/closed indicator. -->
                      <span
                        v-else
                        class="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground"
                      >
                        Info
                        <IconChevronDown
                          class="size-3.5 transition-transform"
                          :class="selected?.id === candidate.id && 'rotate-180'"
                        />
                      </span>
                    </span>
                  </button>

                  <!-- Accordion body: the card opens right where the click
                       happened, not below the whole list. -->
                  <div
                    v-if="selected?.id === candidate.id"
                    class="mb-3 space-y-3 rounded-xl border bg-muted/40 p-3"
                  >
                    <div v-if="previewing" class="space-y-2">
                      <Skeleton class="h-4 w-40" />
                      <Skeleton class="h-4 w-64" />
                      <Skeleton class="h-6 w-52" />
                    </div>
                    <template v-else>
                      <PeerCardView :card="preview" compact />
                      <div
                        v-if="previewAdvertisesNothing"
                        class="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-500"
                      >
                        <template v-if="preview?.description">
                          «{{ candidate.name }}» has no skills on its card —
                          matching will lean on its description alone. Sharper
                          first: a template with skills, or
                        </template>
                        <template v-else>
                          You can connect «{{ candidate.name }}», but with an
                          empty card the delegating agent will only ask it when
                          the user names it outright — topic matching has nothing
                          to grip. Better first: give it a description (Edit on
                          its page), a template with skills, or
                        </template>
                        <NuxtLink
                          :to="`/agents/${candidate.id}?tab=knowledge`"
                          class="font-medium underline"
                          >bind it a knowledge base</NuxtLink
                        >, then Re-read the card here.
                      </div>
                      <Button
                        size="sm"
                        class="rounded-full"
                        :disabled="connecting || !preview"
                        @click="connect"
                      >
                        {{
                          connecting ? 'Connecting…' : `Connect «${candidate.name}»`
                        }}
                      </Button>
                    </template>
                    <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
                  </div>
                </li>
              </ul>

              <p v-else-if="filter" class="text-sm text-muted-foreground">
                No agent matches "{{ filter }}".
              </p>
              <p v-else class="text-sm text-muted-foreground">
                No unconnected agents left on this ranch. Anything outside
                it comes in under <b>By address</b> or <b>From a card</b>.
              </p>
            </TabsContent>

            <!-- ═══ Import by URL (CLEAN-95) ═══ -->
            <TabsContent value="external">
              <!-- Autofill off on both fields, `new-password` on the
                   credential: a text field directly above a password field
                   is the exact shape Chrome and the password managers read
                   as a login form, and they were dropping a saved account
                   into the card address (CLEAN-98). -->
              <div class="space-y-2">
                <Input
                  v-model="url"
                  name="peer-card-address"
                  placeholder="https://other.ranch/a2a/agents/agent-…"
                  class="font-mono text-xs"
                  autocomplete="off"
                  autocorrect="off"
                  autocapitalize="off"
                  spellcheck="false"
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                />
                <Input
                  v-model="urlToken"
                  type="password"
                  name="peer-outbound-token"
                  placeholder="Access credential (optional)"
                  class="text-xs"
                  autocomplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                />
                <Button
                  size="sm"
                  variant="outline"
                  class="rounded-full"
                  :disabled="urlPreviewing || !url.trim()"
                  @click="previewUrl"
                >
                  {{ urlPreviewing ? 'Reading…' : 'Read card' }}
                </Button>
              </div>

              <div
                v-if="urlPreview"
                class="mt-2.5 space-y-3 rounded-xl border bg-muted/40 p-3"
              >
                <PeerCardView :card="urlPreview" compact />
                <div
                  v-if="urlPreviewAdvertisesNothing"
                  class="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-500"
                >
                  <template v-if="urlPreview.description">
                    «{{ urlPreview.name }}» publishes no skills — matching will
                    lean on its description alone. Ask its owner to publish
                    skills, then Re-read the card here.
                  </template>
                  <template v-else>
                    This card advertises nothing, so the delegating agent will
                    only ask «{{ urlPreview.name }}» when the user names it
                    outright. Ask its owner to publish a description and
                    skills, then Re-read the card here.
                  </template>
                </div>
                <Button
                  size="sm"
                  class="rounded-full"
                  :disabled="urlImporting"
                  @click="importUrl"
                >
                  {{
                    urlImporting
                      ? 'Connecting…'
                      : `Connect «${urlPreview.name}»`
                  }}
                </Button>
              </div>

              <p v-if="urlError" class="mt-2 text-sm text-destructive">
                {{ urlError }}
              </p>
            </TabsContent>

            <!-- ═══ Connect from a card in hand (CLEAN-116) ═══ -->
            <TabsContent value="card">
              <div class="space-y-2">
                <textarea
                  v-model="cardText"
                  rows="8"
                  spellcheck="false"
                  autocomplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  placeholder='{ "name": "…", "skills": [ … ], "supportedInterfaces": [ { "url": "https://…" } ] }'
                  class="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
                />
                <div class="flex flex-wrap items-center gap-2">
                  <!-- The file is read in the browser and sent as text: one
                       way in on the API, one set of checks. -->
                  <label
                    class="cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Choose a file
                    <input
                      type="file"
                      accept=".json,.yaml,.yml,.txt,application/json,text/yaml,text/plain"
                      class="hidden"
                      @change="onCardFile"
                    />
                  </label>
                  <span
                    v-if="cardFileName"
                    class="truncate font-mono text-xs text-muted-foreground"
                  >
                    {{ cardFileName }}
                  </span>
                </div>
                <Input
                  v-model="cardToken"
                  type="password"
                  name="peer-card-token"
                  placeholder="Access credential (optional)"
                  class="text-xs"
                  autocomplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                />
                <Button
                  size="sm"
                  variant="outline"
                  class="rounded-full"
                  :disabled="cardPreviewing || !cardText.trim()"
                  @click="previewPastedCard"
                >
                  {{ cardPreviewing ? 'Reading…' : 'Read card' }}
                </Button>
              </div>

              <div
                v-if="cardPreview"
                class="mt-2.5 space-y-3 rounded-xl border bg-muted/40 p-3"
              >
                <PeerCardView :card="cardPreview" compact />
                <div
                  v-if="cardPreviewAdvertisesNothing"
                  class="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-500"
                >
                  This card publishes no skills, so the delegating agent will
                  only ask «{{ cardPreview.name }}» when someone names it
                  outright. Ask its owner for a card with skills, then paste
                  that one.
                </div>
                <Button
                  size="sm"
                  class="rounded-full"
                  :disabled="cardImporting"
                  @click="importCard"
                >
                  {{
                    cardImporting
                      ? 'Connecting…'
                      : `Connect «${cardPreview.name}»`
                  }}
                </Button>
              </div>

              <p v-if="cardError" class="mt-2 text-sm text-destructive">
                {{ cardError }}
              </p>
            </TabsContent>
          </div>
        </Tabs>

        <div class="mt-3.5 flex justify-end">
          <Button
            variant="outline"
            class="rounded-full"
            @click="emit('update:open', false)"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
