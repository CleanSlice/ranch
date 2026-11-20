<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Checkbox } from '#theme/components/ui/checkbox';
import { Input } from '#theme/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '#theme/components/ui/sheet';
import {
  ASSISTANT_LEVELS,
  type AssistantLevel,
  type AssistantLevelOrCustom,
  type IAbility,
  type IAssistantCatalog,
  type PersonRole,
} from '#assistantAccess/domain';
import {
  LEVEL_LABELS,
  applyLevel,
  areaState,
  ceilingNames,
  filterAreas,
  isAbove,
  matchingLevel,
  offeredNames,
  setArea,
  toggleArea,
  untickDestructive,
} from '#assistantAccess/utils/assistantAccess';

/**
 * The detailed choice: area by area, ability by ability (CLEAN-240, spec
 * story 4). One step deeper than the level on purpose — the common case
 * never opens this. The same panel serves a role and one account.
 *
 * Nothing is saved until Save. What is held here is a form: the names the
 * person has ticked. The record stays in the store.
 */
const props = defineProps<{
  open: boolean;
  /** "Admins", "Users", or the person's name. */
  subject: string;
  /** Whose ceiling applies: abilities above it are shown and cannot be ticked. */
  role: PersonRole;
  catalog: IAssistantCatalog;
  level: AssistantLevelOrCustom;
  /** The stored pick, when the level is custom. */
  on: readonly string[];
  /** Abilities that appeared after the pick was saved. */
  fresh?: readonly string[];
  /** For an Admin editing a User: the names they may hand out. */
  ceiling?: readonly string[] | null;
  saving?: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  'update:open': [open: boolean];
  save: [choice: { level: AssistantLevelOrCustom; on: string[] }];
}>();

const confirmStore = useConfirmStore();

const picked = ref<Set<string>>(new Set());
const search = ref('');
const onlyWrites = ref(false);
const openAreas = ref<Set<string>>(new Set());

// A fresh form every time the panel opens: Cancel leaves nothing behind.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    picked.value = offeredNames(props.catalog, props.role, {
      level: props.level,
      on: props.on,
    });
    search.value = '';
    onlyWrites.value = false;
    openAreas.value = new Set();
  },
  { immediate: true },
);

const freshNames = computed(() => new Set(props.fresh ?? []));
const handOut = computed(() => (props.ceiling ? new Set(props.ceiling) : null));

/** Why an ability cannot be ticked, or null when it can. */
function lockedReason(ability: IAbility): string | null {
  if (isAbove(ability, props.role)) {
    return ability.minRole === 'Owner' ? 'Owner only' : 'Admins and above';
  }
  if (handOut.value && !handOut.value.has(ability.name)) return 'More than you have';
  return null;
}

const areas = computed(() =>
  filterAreas(props.catalog, search.value, onlyWrites.value),
);
const filtering = computed(() => search.value.trim() !== '' || onlyWrites.value);

const available = computed(() => ceilingNames(props.catalog, props.role).length);
const current = computed<AssistantLevel | null>(() =>
  matchingLevel(props.catalog, props.role, picked.value),
);
const dirty = computed(() => {
  const before = offeredNames(props.catalog, props.role, {
    level: props.level,
    on: props.on,
  });
  return (
    before.size !== picked.value.size ||
    [...before].some((name) => !picked.value.has(name))
  );
});

/** What an Admin may not hand out stays out, whatever is clicked. */
function within(names: Set<string>): Set<string> {
  if (!handOut.value) return names;
  const allowed = handOut.value;
  return new Set([...names].filter((name) => allowed.has(name)));
}

function toggleAbility(ability: IAbility, value: boolean) {
  if (lockedReason(ability)) return;
  const next = new Set(picked.value);
  if (value) next.add(ability.name);
  else next.delete(ability.name);
  picked.value = next;
}

function areaOf(key: string) {
  return props.catalog.areas.find((area) => area.key === key);
}

function onToggleArea(key: string) {
  const area = areaOf(key);
  if (area) picked.value = within(toggleArea(area, props.role, picked.value));
}

function onSetArea(key: string, value: boolean) {
  const area = areaOf(key);
  if (area) picked.value = within(setArea(area, props.role, picked.value, value));
}

function toggleOpen(key: string) {
  const next = new Set(openAreas.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  openAreas.value = next;
}

/** A level as a starting point. Replacing a custom pick asks first. */
async function startFrom(level: AssistantLevel) {
  if (current.value === null && picked.value.size > 0) {
    const yes = await confirmStore.ask({
      title: `Start from ${LEVEL_LABELS[level]}`,
      description: 'This replaces your custom choice.',
      confirmLabel: 'Replace',
      variant: 'default',
    });
    if (!yes) return;
  }
  picked.value = within(applyLevel(props.catalog, props.role, level));
}

function removeDestructive() {
  picked.value = untickDestructive(props.catalog, picked.value);
}

function save() {
  // A pick that equals a level is saved as the level: it then follows the
  // level when a release adds an ability, which is what picking it meant.
  const level = current.value;
  emit(
    'save',
    level
      ? { level, on: [] }
      : { level: 'custom', on: [...picked.value].sort() },
  );
}
</script>

<template>
  <Sheet :open="open" @update:open="(value: boolean) => emit('update:open', value)">
    <SheetContent side="right" class="w-full gap-0 sm:max-w-lg" data-assistant-advanced>
      <SheetHeader class="shrink-0 border-b pr-12">
        <SheetTitle>{{ subject }} · what the assistant offers</SheetTitle>
        <SheetDescription>
          Area by area. Nothing here gives more than the role can do in the
          console.
        </SheetDescription>
      </SheetHeader>

      <div class="flex shrink-0 flex-col gap-3 border-b px-4 py-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Start from</span>
            <div class="inline-flex gap-0.5 rounded-md border bg-muted p-0.5">
              <button
                v-for="level in ASSISTANT_LEVELS"
                :key="level"
                type="button"
                :data-start-from="level"
                :data-state="current === level ? 'on' : 'off'"
                class="rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs"
                @click="startFrom(level)"
              >
                {{ LEVEL_LABELS[level] }}
              </button>
            </div>
          </div>
          <span class="text-xs font-medium tabular-nums" data-advanced-count>
            {{ current ? LEVEL_LABELS[current] : 'Custom' }} · {{ picked.size }} of {{ available }}
          </span>
        </div>

        <Input v-model="search" placeholder="Search abilities" data-advanced-search />

        <div class="flex flex-wrap items-center justify-between gap-2">
          <label class="flex items-center gap-2 text-xs">
            <Checkbox v-model="onlyWrites" data-advanced-only-writes />
            Only the ones that change things
          </label>
          <Button
            variant="outline"
            size="sm"
            data-advanced-no-deletes
            @click="removeDestructive"
          >
            Untick everything that deletes
          </Button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <p
          v-if="!areas.length"
          class="p-4 text-center text-sm text-muted-foreground"
        >
          No ability matches.
        </p>

        <section
          v-for="area in areas"
          :key="area.key"
          class="border-b last:border-b-0"
          :data-area="area.key"
        >
          <div class="flex items-center gap-3 px-2 py-2">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              :aria-expanded="filtering || openAreas.has(area.key)"
              :aria-controls="`area-${area.key}`"
              @click="toggleOpen(area.key)"
            >
              <span
                class="inline-block w-3 text-muted-foreground transition-transform"
                :class="(filtering || openAreas.has(area.key)) && 'rotate-90'"
                aria-hidden="true"
              >›</span>
              <span class="truncate">{{ area.title }}</span>
            </button>
            <span class="shrink-0 text-xs text-muted-foreground tabular-nums">
              {{ areaState(areaOf(area.key)!, role, picked).offered }} of
              {{ areaState(areaOf(area.key)!, role, picked).available }}
              <template v-if="areaState(areaOf(area.key)!, role, picked).above">
                · {{ areaState(areaOf(area.key)!, role, picked).above }} above the role
              </template>
            </span>
            <AssistantAccessAreaSwitch
              :state="areaState(areaOf(area.key)!, role, picked).state"
              :label="`${area.title}: all abilities`"
              :disabled="areaState(areaOf(area.key)!, role, picked).available === 0"
              @toggle="onToggleArea(area.key)"
            />
          </div>

          <div
            v-if="filtering || openAreas.has(area.key)"
            :id="`area-${area.key}`"
            class="pb-2 pl-7 pr-2"
          >
            <div v-if="!filtering" class="mb-1 flex gap-3 text-xs">
              <button type="button" class="underline-offset-2 hover:underline" @click="onSetArea(area.key, true)">
                All
              </button>
              <button type="button" class="underline-offset-2 hover:underline" @click="onSetArea(area.key, false)">
                None
              </button>
            </div>
            <label
              v-for="ability in area.abilities"
              :key="ability.name"
              class="flex items-start gap-2 rounded-sm px-1 py-1 text-sm"
              :class="lockedReason(ability) ? 'text-muted-foreground' : 'hover:bg-muted/50'"
              :data-ability="ability.name"
            >
              <Checkbox
                class="mt-0.5"
                :model-value="picked.has(ability.name)"
                :disabled="lockedReason(ability) !== null"
                @update:model-value="(value: boolean | 'indeterminate') => toggleAbility(ability, value === true)"
              />
              <span class="min-w-0 flex-1 break-words">{{ ability.title }}</span>
              <span class="flex shrink-0 flex-wrap justify-end gap-1 text-[11px] text-muted-foreground">
                <span v-if="freshNames.has(ability.name)" class="rounded-full bg-primary/10 px-1.5 text-primary">new</span>
                <span v-if="lockedReason(ability)" class="rounded-full border px-1.5">{{ lockedReason(ability) }}</span>
                <template v-else>
                  <span v-if="ability.destructive" class="rounded-full border border-rose-500/40 px-1.5 text-rose-700 dark:text-rose-300">deletes</span>
                  <span v-else-if="ability.effect === 'write'" class="rounded-full border px-1.5">changes</span>
                </template>
              </span>
            </label>
          </div>
        </section>

        <details v-if="catalog.alwaysOn.length" class="px-2 py-3 text-xs text-muted-foreground">
          <summary class="cursor-pointer">
            Always on: {{ catalog.alwaysOn.length }} abilities the assistant needs to talk at all
          </summary>
          <ul class="mt-2 list-disc pl-5">
            <li v-for="ability in catalog.alwaysOn" :key="ability.name">{{ ability.title }}</li>
          </ul>
        </details>
      </div>

      <SheetFooter class="shrink-0 flex-col gap-2 border-t sm:flex-col">
        <p v-if="error" class="text-sm text-destructive" role="alert" data-advanced-error>
          {{ error }}
        </p>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" :disabled="saving" @click="emit('update:open', false)">
            Cancel
          </Button>
          <Button :disabled="!dirty || saving" data-advanced-save @click="save">
            {{ saving ? 'Saving…' : 'Save' }}
          </Button>
        </div>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
