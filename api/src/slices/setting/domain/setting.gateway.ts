import { ISettingData, IUpsertSettingData } from './setting.types';
import type { ISettingWriter } from './settingScope';

/** The stored form of a setting row, as a write hook sees it. */
export interface IStoredSetting {
  valueType: string;
  value: string;
}

/**
 * Told about a write a PERSON makes, inside the write's own transaction
 * (CLEAN-271). `before` and `after` are the stored row, null for "no row".
 * `tx` is the transaction's client, typed loosely because this file does
 * not know the tables its listener keeps.
 */
export interface ISettingWriteHook {
  onWrite(
    tx: unknown,
    change: {
      group: string;
      name: string;
      before: IStoredSetting | null;
      after: IStoredSetting | null;
      by: ISettingWriter;
    },
  ): Promise<void>;
}

export abstract class ISettingGateway {
  abstract findAll(): Promise<ISettingData[]>;
  abstract findByGroup(group: string): Promise<ISettingData[]>;
  abstract findByKey(group: string, name: string): Promise<ISettingData | null>;
  abstract upsert(
    group: string,
    name: string,
    data: IUpsertSettingData,
  ): Promise<ISettingData>;
  abstract delete(group: string, name: string): Promise<void>;

  /**
   * A write made by a person: `data` to set the row, null to delete it.
   * The same as `upsert` / `delete`, plus the write hook in the same
   * transaction, which is what keeps the Ranch assistant on the values the
   * Owner approved (CLEAN-271). The routes and the tools write through
   * this; `upsert` and `delete` stay for the platform's own bookkeeping.
   */
  async writeBy(
    group: string,
    name: string,
    data: IUpsertSettingData | null,
    _by: ISettingWriter,
  ): Promise<ISettingData | null> {
    if (data === null) {
      await this.delete(group, name);
      return null;
    }
    return this.upsert(group, name, data);
  }

  /** Register the listener of person-made writes; one, set at start. */
  attachWriteHook(_hook: ISettingWriteHook): void {}
}

/**
 * `gateway.writeBy`, for a caller that may hold a stand-in gateway (a spec's
 * object with `upsert` and `delete` only).
 */
export async function writeSettingBy(
  gateway: ISettingGateway,
  group: string,
  name: string,
  data: IUpsertSettingData | null,
  by: ISettingWriter,
): Promise<ISettingData | null> {
  if (typeof gateway.writeBy === 'function') {
    return gateway.writeBy(group, name, data, by);
  }
  if (data === null) {
    await gateway.delete(group, name);
    return null;
  }
  return gateway.upsert(group, name, data);
}
