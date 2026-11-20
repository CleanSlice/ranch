<script setup lang="ts">
import { toast } from 'vue-sonner';
import { Button } from '#theme/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import { Switch } from '#theme/components/ui/switch';
import { formatStampDate } from '#common/utils/format';
import {
  ASSISTANT_ROLES,
  AssistantAccessRefusal,
  type AssistantLevel,
  type AssistantLevelOrCustom,
  type AssistantRole,
  type IAssistantRoleData,
  type ISetAssistantInput,
} from '#assistantAccess/domain';
import {
  LEVEL_LABELS,
  levelsFor,
  lossSummary,
} from '#assistantAccess/utils/assistantAccess';

/**
 * Who can use the assistant (CLEAN-240, contracts/ui.md §A): one row for
 * Admins and one for Users — a switch, a level, the way into the detailed
 * choice — and under them everybody who differs from their role.
 *
 * The Owner's card. A change that takes abilities away from people asks
 * once, with how many of them and how much; one that only gives more is
 * saved at once and can be undone from the toast.
 */
const store = useAssistantAccessStore();
const confirmStore = useConfirmStore();

const loadError = ref<string | null>(null);
const saving = ref<AssistantRole | null>(null);
const rowError = ref<Partial<Record<AssistantRole, string>>>({});
const advancedFor = ref<AssistantRole | null>(null);
const advancedError = ref<string | null>(null);
// What the choice in the Advanced panel would cost, asked inside the panel.
const advancedWarning = ref<string | null>(null);

const messageOf = (err: unknown, fallback: string): string =>
  err instanceof AssistantAccessRefusal || err instanceof Error
    ? err.message
    : fallback;

onMounted(async () => {
  try {
    await Promise.all([store.fetchOverview(), store.fetchCatalog()]);
  } catch (err) {
    loadError.value = messageOf(err, 'The assistant settings could not be read.');
  }
});

const ROLE_LABELS: Record<AssistantRole, string> = {
  Admin: 'Admins',
  User: 'Users',
};

const rows = computed(() =>
  store.roles
    ? ASSISTANT_ROLES.map((role) => ({ role, setting: store.roles![role] }))
    : [],
);

function choiceOf(setting: IAssistantRoleData) {
  return {
    enabled: setting.enabled,
    level: setting.level,
    on: setting.pick?.on ?? [],
  };
}

/** The number of abilities a change takes away from the people it covers. */
function lossOf(
  role: AssistantRole,
  setting: IAssistantRoleData,
  input: ISetAssistantInput,
): number {
  if (!store.catalog) return 0;
  const before = choiceOf(setting);
  return lossSummary(store.catalog, role, before, {
    enabled: input.enabled ?? before.enabled,
    level: input.level ?? before.level,
    on: input.on ?? before.on,
  });
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** "2 accounts lose 42 abilities." — who pays for a narrower choice. */
function lossText(setting: IAssistantRoleData, lost: number): string {
  return (
    `${plural(setting.accounts, 'account loses', 'accounts lose')} ` +
    `${plural(lost, 'ability', 'abilities')}. People with their own ` +
    'setting keep it. It applies from their next message.'
  );
}

async function change(
  role: AssistantRole,
  input: ISetAssistantInput,
  undo?: ISetAssistantInput,
  /** The question was already asked where the change was made. */
  asked = false,
): Promise<boolean> {
  const setting = store.roles?.[role];
  if (!setting || saving.value) return false;

  const lost = lossOf(role, setting, input);
  if (lost > 0 && !asked) {
    const yes = await confirmStore.ask({
      title:
        input.enabled === false
          ? `Switch the assistant off for ${ROLE_LABELS[role]}`
          : `Give ${ROLE_LABELS[role]} less`,
      description: lossText(setting, lost),
      confirmLabel: 'Change',
      variant: 'default',
    });
    if (!yes) return false;
  }

  saving.value = role;
  rowError.value = { ...rowError.value, [role]: undefined };
  try {
    await store.saveRole(role, input);
    toast.success(`${ROLE_LABELS[role]} updated`, {
      ...(undo
        ? {
            action: {
              label: 'Undo',
              onClick: () => void change(role, undo),
            },
          }
        : {}),
    });
    return true;
  } catch (err) {
    rowError.value = {
      ...rowError.value,
      [role]: messageOf(err, 'The setting could not be saved.'),
    };
    // A stale version means someone else changed it: show what is there now.
    void store.fetchOverview().catch(() => undefined);
    return false;
  } finally {
    saving.value = null;
  }
}

function onSwitch(role: AssistantRole, setting: IAssistantRoleData, enabled: boolean) {
  void change(role, { enabled }, { enabled: setting.enabled });
}

function onLevel(role: AssistantRole, setting: IAssistantRoleData, level: AssistantLevel) {
  void change(
    role,
    { level },
    setting.level === 'custom'
      ? { level: 'custom', on: setting.pick?.on ?? [] }
      : { level: setting.level },
  );
}

async function onAdvancedSave(choice: {
  level: AssistantLevelOrCustom;
  on: string[];
  confirmed: boolean;
}) {
  const role = advancedFor.value;
  const setting = role ? store.roles?.[role] : null;
  if (!role || !setting) return;
  advancedError.value = null;
  const input: ISetAssistantInput =
    choice.level === 'custom'
      ? { level: 'custom', on: choice.on }
      : { level: choice.level };

  // A narrower choice is asked about in the panel itself: the first Save
  // says what it costs, the second one ("Save anyway") makes it.
  const lost = lossOf(role, setting, input);
  if (lost > 0 && !choice.confirmed) {
    advancedWarning.value = lossText(setting, lost);
    return;
  }
  const saved = await change(role, input, undefined, true);
  if (saved) closeAdvanced();
  else advancedError.value = rowError.value[role] ?? null;
}

function closeAdvanced() {
  advancedFor.value = null;
  advancedWarning.value = null;
  advancedError.value = null;
}

const resetting = ref<string | null>(null);
async function reset(userId: string) {
  if (resetting.value) return;
  resetting.value = userId;
  try {
    await store.resetAccount(userId);
  } catch (err) {
    toast.error(messageOf(err, 'The setting could not be reset.'));
  } finally {
    resetting.value = null;
  }
}

const advancedRole = computed(() => advancedFor.value);
const advancedSetting = computed(() =>
  advancedRole.value ? (store.roles?.[advancedRole.value] ?? null) : null,
);
</script>

<template>
  <Card data-assistant-card>
    <CardHeader>
      <CardTitle>Who can use the assistant</CardTitle>
      <CardDescription>
        What Admins and Users get from it in chat. The Owner always has
        everything. No level gives a role more than it can do in the console.
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-5">
      <p v-if="loadError" class="text-sm text-destructive" role="alert">
        {{ loadError }}
      </p>
      <p v-else-if="!store.roles" class="text-sm text-muted-foreground">
        Loading…
      </p>

      <template v-else>
        <p
          v-if="!store.assistant"
          class="rounded-md border border-dashed p-3 text-sm text-muted-foreground"
          data-assistant-none
        >
          No assistant yet. What you set here applies once an agent is made
          the Ranch admin.
        </p>

        <div
          v-if="store.notice"
          class="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          role="status"
          data-assistant-notice
        >
          <span>
            Users now start on Basic: they see and ask, and change nothing.
            {{ plural(store.notice.usersManagingAgents, 'User has', 'Users have') }}
            agents of their own and can no longer manage them through the
            assistant.
          </span>
          <span class="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="outline"
              :disabled="saving !== null"
              data-assistant-notice-raise
              @click="change('User', { level: 'standard' })"
            >
              Raise Users to Standard
            </Button>
            <Button
              size="sm"
              variant="ghost"
              :disabled="saving !== null"
              data-assistant-notice-keep
              @click="change('User', { level: 'basic' })"
            >
              Keep Basic
            </Button>
          </span>
        </div>

        <div class="flex flex-col divide-y rounded-md border">
          <div
            v-for="row in rows"
            :key="row.role"
            class="flex flex-col gap-2 px-3 py-3"
            :data-assistant-role="row.role"
          >
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div class="flex w-28 shrink-0 items-center gap-3">
                <Switch
                  :model-value="row.setting.enabled"
                  :disabled="saving !== null"
                  :aria-label="`The assistant for ${ROLE_LABELS[row.role]}`"
                  @update:model-value="(value: boolean) => onSwitch(row.role, row.setting, value)"
                />
                <span class="text-sm font-medium">{{ ROLE_LABELS[row.role] }}</span>
              </div>

              <AssistantAccessLevelPicker
                :level="row.setting.level"
                :levels="store.catalog ? levelsFor(store.catalog, row.role) : []"
                :offered="row.setting.offered"
                :available="row.setting.available"
                :disabled="!row.setting.enabled || saving !== null"
                :label="`Level for ${ROLE_LABELS[row.role]}`"
                @choose="(level: AssistantLevel) => onLevel(row.role, row.setting, level)"
              />

              <Button
                variant="ghost"
                size="sm"
                class="ml-auto"
                :disabled="!row.setting.enabled || !store.catalog"
                :data-assistant-advanced-open="row.role"
                @click="advancedFor = row.role"
              >
                Advanced ›
              </Button>
              <span class="w-24 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {{ plural(row.setting.accounts, 'account', 'accounts') }}
              </span>
            </div>
            <p v-if="!row.setting.enabled" class="text-xs text-muted-foreground">
              Off: {{ ROLE_LABELS[row.role] }} do not see the assistant, unless it was set for their account.
            </p>
            <p
              v-if="rowError[row.role]"
              class="text-sm text-destructive"
              role="alert"
              :data-assistant-error="row.role"
            >
              {{ rowError[row.role] }}
            </p>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <h3 class="text-sm font-medium">Different for these accounts</h3>
          <p
            v-if="!store.exceptions.length"
            class="text-sm text-muted-foreground"
            data-assistant-no-exceptions
          >
            Everyone follows their role.
          </p>
          <ul v-else class="flex flex-col divide-y rounded-md border" data-assistant-exceptions>
            <li
              v-for="item in store.exceptions"
              :key="item.userId"
              class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm"
              :data-assistant-exception="item.userId"
            >
              <span class="min-w-0 flex-1 truncate">
                <span class="font-medium">{{ item.name || item.email }}</span>
                <span class="text-muted-foreground"> · {{ item.role }}</span>
              </span>
              <span class="shrink-0">
                {{ item.resolved.enabled ? LEVEL_LABELS[item.resolved.level] : 'Off' }}
                <span
                  v-if="item.resolved.enabled && item.resolved.level === 'custom'"
                  class="text-xs text-muted-foreground tabular-nums"
                >
                  · {{ item.resolved.offered }} of {{ item.resolved.available }}
                </span>
                <span v-if="item.reducedByRole" class="text-xs text-amber-700 dark:text-amber-300">
                  · reduced to what {{ item.role }}s can have
                </span>
              </span>
              <span class="shrink-0 text-xs text-muted-foreground">
                <template v-if="item.updatedBy">set by {{ item.updatedBy }}, </template>
                {{ formatStampDate(item.updatedAt) }}
              </span>
              <span class="flex shrink-0 gap-1">
                <Button as-child variant="ghost" size="sm">
                  <NuxtLink :to="`/users/${item.userId}`">Open</NuxtLink>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="resetting !== null"
                  :data-assistant-reset="item.userId"
                  @click="reset(item.userId)"
                >
                  Reset
                </Button>
              </span>
            </li>
          </ul>
        </div>
      </template>
    </CardContent>

    <AssistantAccessAdvanced
      v-if="store.catalog && advancedRole && advancedSetting"
      :open="advancedFor !== null"
      :subject="ROLE_LABELS[advancedRole]"
      :role="advancedRole"
      :catalog="store.catalog"
      :level="advancedSetting.level"
      :on="advancedSetting.pick?.on ?? []"
      :fresh="advancedSetting.pick?.new ?? []"
      :saving="saving !== null"
      :error="advancedError"
      :warning="advancedWarning"
      @update:open="(value: boolean) => { if (!value) closeAdvanced(); }"
      @edited="advancedWarning = null"
      @save="onAdvancedSave"
    />
  </Card>
</template>
