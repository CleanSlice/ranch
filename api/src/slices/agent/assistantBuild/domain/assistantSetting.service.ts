import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  ISettingGateway,
  registerAssistantSettings,
  settingKeyOf,
  type IAssistantSettingSource,
  type ISettingData,
  type ISettingDrift,
  type ISettingWriteHook,
  type ISettingWriter,
  type IStoredSetting,
  type SettingOverrides,
} from '#/setting/domain';

/**
 * The setting groups the Ranch assistant is served the APPROVED values of
 * (CLEAN-271): every group that is read while its pod is deployed or while
 * the API works on its behalf.
 *
 *   integrations    the hub address and key, the bucket, the S3 endpoints
 *                   and keys, the secret provider, the API address the pod
 *                   calls with its token
 *   infrastructure  where its manifest (which holds that token) is
 *                   submitted, the namespace its pod is looked for in, the
 *                   retrieval service
 *   knowledge       whether and where its knowledge bases are asked
 *   agent_defaults  the image its template is generated with
 *   a2a             whether an agent may arrange its own connections
 *
 * Whole groups, not keys: a key added to one of them tomorrow is covered the
 * day it is added. `assistantSettings.spec.ts` runs the real deploy path
 * with a gateway that records every read and fails on a group that is not
 * here, so a read from a new group cannot slip past.
 */
export const APPROVED_SETTING_GROUPS: readonly string[] = [
  'integrations',
  'infrastructure',
  'knowledge',
  'agent_defaults',
  'a2a',
];

export function isApprovedSettingGroup(group: string): boolean {
  return APPROVED_SETTING_GROUPS.includes(group);
}

interface IPinRow {
  group: string;
  name: string;
  present: boolean;
  valueType: string;
  value: string;
  changedById: string | null;
  changedAt: Date;
}

/** The table, as much of a Prisma client as this file uses. */
interface IPinClient {
  assistantSettingPin: {
    findMany(args?: object): Promise<IPinRow[]>;
    findUnique(args: object): Promise<IPinRow | null>;
    create(args: object): Promise<IPinRow>;
    deleteMany(args?: object): Promise<{ count: number }>;
  };
  setting: {
    findMany(
      args?: object,
    ): Promise<
      { group: string; name: string; valueType: string; value: string }[]
    >;
  };
}

const same = (a: IStoredSetting | null, b: IStoredSetting | null): boolean =>
  (a === null && b === null) ||
  (a !== null &&
    b !== null &&
    a.valueType === b.valueType &&
    a.value === b.value);

const stored = (pin: IPinRow): IStoredSetting | null =>
  pin.present ? { valueType: pin.valueType, value: pin.value } : null;

/** The row as `ISettingGateway` answers it; `SettingMapper.toEntity`'s decoding. */
function asSetting(pin: IPinRow): ISettingData | null {
  if (!pin.present) return null;
  let value: unknown = pin.value;
  if (pin.valueType === 'json') {
    try {
      value = JSON.parse(pin.value);
    } catch {
      value = null;
    }
  }
  return {
    id: `approved-${pin.group}-${pin.name}`,
    group: pin.group,
    name: pin.name,
    valueType: pin.valueType === 'json' ? 'json' : 'string',
    value,
    updatedAt: pin.changedAt,
  };
}

/**
 * The Ranch assistant is deployed from the settings the Owner approved, not
 * from the live ones (CLEAN-271).
 *
 * An Admin runs the installation from the Settings pages and keeps doing
 * so. But several settings decide what the assistant loads and where its
 * token goes: point `integrations.s3_bucket` at another bucket and its next
 * restart pulls its instructions from there; point `infrastructure.argo_url`
 * or `integrations.ranch_api_url` elsewhere and its Owner token is posted
 * there. So for the assistant a setting changed by anybody but the Owner
 * keeps the value it had, until the Owner applies the change.
 *
 * How:
 *
 *  - Every write a person makes goes through `ISettingGateway.writeBy`,
 *    which calls `onWrite` here inside the write's transaction. A write by
 *    anybody but the Owner to an approved group puts the value the setting
 *    HAD into `AssistantSettingPin`, unless one is kept already. A write by
 *    the Owner removes the pin: the approved value follows the Owner. A
 *    value that comes back to the approved one removes it too.
 *  - Work done for the assistant runs inside `servingAssistant(true, ...)`
 *    (`#/setting/domain`): the deploy path, the env preview, and every
 *    request that carries its token or names its id anywhere
 *    (`AssistantSettingInterceptor`). Inside it the one reader of settings,
 *    `ISettingGateway`, answers a pinned key with the pinned value. Work
 *    for another agent says so and reads live.
 *  - No pin means approved = live, which is the state of every installation
 *    at the migration and of every setting nobody but the Owner touched.
 *    There is no copy of the settings to initialise and none to keep in
 *    step; promoting another agent to be the assistant needs nothing.
 *  - A pin is a drift. `drift()` lists them for the Owner, by key, with who
 *    and when, and never a value. `applyExact(shown)` drops the ones the
 *    Owner was shown: their live values become the approved ones.
 *  - Work that does not say whom it is for reads the approved values too
 *    (`settingScope.ts`): forgetting to declare fails towards the Owner.
 *
 * The platform's own writes (`upsert` / `delete` on the gateway: seeded
 * defaults, a migration flag) are not a person's and move nothing.
 */
@Injectable()
export class AssistantSettingService
  implements IAssistantSettingSource, ISettingWriteHook, OnModuleInit
{
  private readonly logger = new Logger(AssistantSettingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ISettingGateway,
    private readonly agents: IAgentGateway,
  ) {}

  onModuleInit(): void {
    this.settings.attachWriteHook(this);
    registerAssistantSettings(this);
  }

  private get table(): IPinClient {
    return this.prisma as unknown as IPinClient;
  }

  // ── reading ──

  /**
   * Read from the table every time: it is a handful of rows at most, and a
   * remembered answer would serve the assistant a value an Admin changed a
   * moment ago on another copy of the API.
   */
  async overrides(): Promise<SettingOverrides> {
    const pins = await this.table.assistantSettingPin.findMany();
    return new Map(
      pins.map((pin) => [settingKeyOf(pin.group, pin.name), asSetting(pin)]),
    );
  }

  async assistantId(): Promise<string | null> {
    return (await this.agents.findAdmin())?.id ?? null;
  }

  async drift(): Promise<ISettingDrift[]> {
    const [pins, live] = await Promise.all([
      this.table.assistantSettingPin.findMany({
        orderBy: [{ group: 'asc' }, { name: 'asc' }],
      }),
      // Live on purpose, whatever the caller's scope: this is the comparison
      // of the live settings with the approved ones.
      this.settings.liveVersions(),
    ]);
    return pins.map((pin) => {
      const written = live.get(settingKeyOf(pin.group, pin.name));
      return {
        group: pin.group,
        name: pin.name,
        change: !pin.present ? 'added' : written ? 'changed' : 'removed',
        changedById: pin.changedById,
        changedAt: pin.changedAt,
        version: `${pin.changedAt.toISOString()}/${written ? written.toISOString() : '-'}`,
      };
    });
  }

  // ── writing ──

  async onWrite(
    tx: unknown,
    change: {
      group: string;
      name: string;
      before: IStoredSetting | null;
      after: IStoredSetting | null;
      by: ISettingWriter;
    },
  ): Promise<void> {
    if (!isApprovedSettingGroup(change.group)) return;
    const table = (tx as IPinClient).assistantSettingPin;
    const where = { group: change.group, name: change.name };

    // The Owner's write is the approval.
    if (change.by.owner) {
      await table.deleteMany({ where });
      return;
    }
    const pin = await table.findUnique({ where: { group_name: where } });
    const approved = pin ? stored(pin) : change.before;
    if (same(approved, change.after)) {
      // Back to what the Owner approved, or never away from it.
      if (pin) await table.deleteMany({ where });
      return;
    }
    if (pin) {
      // Changed again: the approved value stays, and the row says who
      // changed the setting LAST and when, so that an apply made from an
      // older look at the list is refused (`applyExact`).
      await table.deleteMany({ where });
      await table.create({
        data: {
          ...where,
          present: pin.present,
          valueType: pin.valueType,
          value: pin.value,
          changedById: change.by.userId,
        },
      });
      return;
    }
    await table.create({
      data: {
        ...where,
        present: change.before !== null,
        valueType: change.before?.valueType ?? 'string',
        value: change.before?.value ?? '',
        changedById: change.by.userId,
      },
    });
    this.logger.log(
      `Setting ${change.group}.${change.name} changed by ${change.by.userId ?? 'somebody'}: the Ranch assistant keeps the value the Owner approved`,
    );
  }

  /**
   * The Owner's "apply current settings to the assistant": the live values
   * of exactly the settings the Owner was SHOWN become the approved ones.
   *
   * `shown` is the list as the Owner read it, each with its `version`. A
   * setting changed, added to or gone from the list since then means the
   * Owner would approve something they did not look at: the whole apply is
   * refused and nothing moves. Each row is deleted on the condition that it
   * is still the row that was shown, inside one transaction, so a change
   * that lands between the comparison and the delete is refused as well.
   */
  async applyExact(
    shown: readonly { group: string; name: string; version: string }[],
  ): Promise<{ group: string; name: string }[]> {
    const current = await this.drift();
    if (driftToken(current) !== driftToken(shown)) throw settingsChanged();
    await this.prisma.$transaction(async (tx) => {
      const table = (tx as unknown as IPinClient).assistantSettingPin;
      for (const row of current) {
        const { count } = await table.deleteMany({
          where: { group: row.group, name: row.name, changedAt: row.changedAt },
        });
        if (count !== 1) throw settingsChanged();
      }
    });
    // The live rows themselves may have been written again without the pin
    // moving only by the Owner, whose write removes the pin: nothing left to
    // compare.
    return current.map((row) => ({ group: row.group, name: row.name }));
  }
}

/** What the apply answers when the list is not the one the Owner was shown. */
export const SETTINGS_CHANGED_CODE = 'SETTINGS_CHANGED';
export const SETTINGS_CHANGED_TEXT =
  'The settings changed since you looked. Read the list again and apply ' +
  'what it shows now. Nothing was applied.';

function settingsChanged(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: SETTINGS_CHANGED_CODE,
    message: SETTINGS_CHANGED_TEXT,
  });
}

/**
 * One short string for a whole list of drift, as the tool hands it to the
 * model with the list and takes it back with the confirmation: the same
 * list gives the same token, any other list another.
 */
export function driftToken(
  rows: readonly { group: string; name: string; version: string }[],
): string {
  const text = rows
    .map((row) => `${row.group}.${row.name}@${row.version}`)
    .sort()
    .join('|');
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
