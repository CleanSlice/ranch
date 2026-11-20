<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Switch } from '#theme/components/ui/switch';
import {
  AssistantAccessRefusal,
  type AssistantLevel,
  type AssistantLevelOrCustom,
  type ISetAssistantInput,
} from '#assistantAccess/domain';
import {
  accountCaption,
  applyLevel,
  levelsFor,
} from '#assistantAccess/utils/assistantAccess';

/**
 * The assistant for one account, on top of its Agent access card (CLEAN-240,
 * contracts/ui.md §B). Apart from the list of agents on purpose: whether an
 * account has the assistant does not depend on which agents it reaches.
 *
 * Saves on its own, one change at a time. The first change gives the account
 * its own setting; "Use the role's setting" drops it again.
 */
const props = defineProps<{ userId: string; name: string }>();

const store = useAssistantAccessStore();

const loadError = ref<string | null>(null);
const saveError = ref<string | null>(null);
const saving = ref(false);
const advancedOpen = ref(false);
const advancedError = ref<string | null>(null);

const messageOf = (err: unknown, fallback: string): string =>
  err instanceof AssistantAccessRefusal || err instanceof Error
    ? err.message
    : fallback;

async function load() {
  loadError.value = null;
  try {
    await Promise.all([store.fetchAccount(props.userId), store.fetchCatalog()]);
  } catch (err) {
    // An Admin looking at an account that is not theirs to set: the card
    // says who manages it, and this block has nothing to add.
    loadError.value =
      err instanceof AssistantAccessRefusal && err.status === 403
        ? ''
        : messageOf(err, 'The assistant setting could not be read.');
  }
}
onMounted(load);
watch(() => props.userId, load);

const account = computed(() => store.accountOf(props.userId));
const roleLabel = computed(() => `${account.value?.role ?? ''}s`);

/** Levels an Admin may not hand out: more than the assistant offers them. */
const blocked = computed<AssistantLevel[]>(() => {
  const current = account.value;
  if (!current?.ceiling || !store.catalog) return [];
  const own = new Set(current.ceiling);
  return levelsFor(store.catalog, current.role).filter((level) =>
    [...applyLevel(store.catalog!, current.role, level)].some((name) => !own.has(name)),
  );
});

async function change(input: ISetAssistantInput): Promise<boolean> {
  if (saving.value) return false;
  saving.value = true;
  saveError.value = null;
  try {
    await store.saveAccount(props.userId, input);
    return true;
  } catch (err) {
    saveError.value = messageOf(err, 'The setting could not be saved.');
    void store.fetchAccount(props.userId).catch(() => undefined);
    return false;
  } finally {
    saving.value = false;
  }
}

async function reset() {
  if (saving.value) return;
  saving.value = true;
  saveError.value = null;
  try {
    await store.resetAccount(props.userId);
  } catch (err) {
    saveError.value = messageOf(err, 'The setting could not be reset.');
  } finally {
    saving.value = false;
  }
}

async function onAdvancedSave(choice: { level: AssistantLevelOrCustom; on: string[] }) {
  advancedError.value = null;
  const saved = await change(
    choice.level === 'custom' ? choice : { level: choice.level },
  );
  if (saved) advancedOpen.value = false;
  else advancedError.value = saveError.value;
}
</script>

<template>
  <!-- '' is "not yours to see": nothing is drawn. -->
  <section
    v-if="loadError !== ''"
    class="flex flex-col gap-2 border-b pb-4"
    data-assistant-account
  >
    <h3 class="text-sm font-medium">Ranch assistant</h3>

    <p v-if="loadError" class="text-sm text-destructive" role="alert">
      {{ loadError }}
    </p>
    <p v-else-if="!account" class="text-sm text-muted-foreground">Loading…</p>

    <template v-else>
      <div
        v-if="account.source !== 'owner'"
        class="flex flex-wrap items-center gap-x-4 gap-y-2"
      >
        <Switch
          :model-value="account.enabled"
          :disabled="!account.editable || saving"
          :aria-label="`The assistant for ${name}`"
          data-assistant-account-switch
          @update:model-value="(value: boolean) => change({ enabled: value })"
        />
        <AssistantAccessLevelPicker
          :level="account.level"
          :levels="store.catalog ? levelsFor(store.catalog, account.role) : []"
          :blocked="blocked"
          blocked-reason="More than you have"
          :offered="account.offered"
          :available="account.available"
          :disabled="!account.editable || !account.enabled || saving"
          :label="`Level for ${name}`"
          @choose="(level: AssistantLevel) => change({ level })"
        />
        <Button
          v-if="account.editable"
          variant="ghost"
          size="sm"
          :disabled="!account.enabled || !store.catalog"
          data-assistant-account-advanced
          @click="advancedOpen = true"
        >
          Advanced ›
        </Button>
      </div>

      <p class="text-xs text-muted-foreground" data-assistant-account-caption>
        {{ accountCaption(account, true) }}
        <template v-if="account.source === 'account' && account.editable">
          ·
          <button
            type="button"
            class="underline underline-offset-2 hover:text-foreground disabled:opacity-60"
            :disabled="saving"
            data-assistant-account-reset
            @click="reset"
          >
            Use the {{ roleLabel }}’ setting
          </button>
        </template>
        <template v-if="account.source !== 'owner' && !account.enabled">
          · Off: this account does not see the assistant.
        </template>
      </p>

      <p
        v-if="saveError"
        class="text-sm text-destructive"
        role="alert"
        data-assistant-account-error
      >
        {{ saveError }}
      </p>

      <AssistantAccessAdvanced
        v-if="store.catalog && account.source !== 'owner'"
        v-model:open="advancedOpen"
        :subject="name"
        :role="account.role"
        :catalog="store.catalog"
        :level="account.level"
        :on="account.pick?.on ?? []"
        :fresh="account.pick?.new ?? []"
        :ceiling="account.ceiling"
        :saving="saving"
        :error="advancedError"
        @save="onAdvancedSave"
      />
    </template>
  </section>
</template>
