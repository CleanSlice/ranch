import { AssistantAccessService as AssistantAccessApi } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IAssistantAccessGateway } from '../domain/assistantAccess.gateway';
import {
  AssistantAccessRefusal,
  type AssistantRole,
  type IAssistantAccountData,
  type IAssistantCatalog,
  type IAssistantOverview,
  type IAssistantRoleData,
  type IMyAssistantAccess,
  type ISetAssistantInput,
} from '../domain/assistantAccess.types';
import { AssistantAccessMapper } from './assistantAccess.mapper';

interface HeyApiResult {
  data?: unknown;
  error?: unknown;
  response?: { status?: number };
}

export class AssistantAccessGateway
  extends BaseGateway
  implements IAssistantAccessGateway
{
  private mapper = new AssistantAccessMapper();

  overview(): Promise<IAssistantOverview> {
    return this.execute(async () => {
      const res = await AssistantAccessApi.getAssistantAccess();
      return this.read(res, 'Reading who can use the assistant', (raw) =>
        this.mapper.toOverview(raw),
      );
    });
  }

  catalog(): Promise<IAssistantCatalog> {
    return this.execute(async () => {
      const res = await AssistantAccessApi.getAssistantCatalog();
      return this.read(res, 'Reading what the assistant can do', (raw) =>
        this.mapper.toCatalog(raw),
      );
    });
  }

  setRole(
    role: AssistantRole,
    input: ISetAssistantInput,
  ): Promise<Omit<IAssistantRoleData, 'accounts'>> {
    return this.execute(async () => {
      const res = await AssistantAccessApi.setAssistantRoleAccess({
        path: { role },
        body: this.mapper.toSetDto(input),
      });
      return this.read(res, 'Saving the assistant setting', (raw) =>
        this.mapper.toRole(raw),
      );
    });
  }

  account(userId: string): Promise<IAssistantAccountData> {
    return this.execute(async () => {
      const res = await AssistantAccessApi.getUserAssistantAccess({
        path: { id: userId },
      });
      return this.read(res, 'Reading the assistant setting', (raw) =>
        this.mapper.toAccount(raw),
      );
    });
  }

  setAccount(
    userId: string,
    input: ISetAssistantInput,
  ): Promise<IAssistantAccountData> {
    return this.execute(async () => {
      const res = await AssistantAccessApi.setUserAssistantAccess({
        path: { id: userId },
        body: this.mapper.toSetDto(input),
      });
      return this.read(res, 'Saving the assistant setting', (raw) =>
        this.mapper.toAccount(raw),
      );
    });
  }

  resetAccount(userId: string): Promise<IAssistantAccountData> {
    return this.execute(async () => {
      const res = await AssistantAccessApi.resetUserAssistantAccess({
        path: { id: userId },
      });
      return this.read(res, 'Resetting the assistant setting', (raw) =>
        this.mapper.toAccount(raw),
      );
    });
  }

  mine(): Promise<IMyAssistantAccess> {
    return this.execute(async () => {
      const res = await AssistantAccessApi.getMyAssistantAccess();
      return this.read(res, 'Reading what the assistant offers you', (raw) =>
        this.mapper.toMine(raw),
      );
    });
  }

  /** The entity, or the API's refusal in its own words. */
  private read<T>(
    res: HeyApiResult,
    action: string,
    map: (raw: unknown) => T | null,
  ): T {
    const err = res.error;
    if (err !== undefined && err !== null) {
      const status = res.response?.status ?? null;
      const body = (typeof err === 'object' ? err : {}) as Record<string, unknown>;
      const code = typeof body.code === 'string' && body.code ? body.code : null;
      const names = Array.isArray(body.names)
        ? body.names.filter((n): n is string => typeof n === 'string')
        : [];
      if (typeof body.message === 'string' && body.message) {
        throw new AssistantAccessRefusal(body.message, code, status, names);
      }
      if (status && status >= 400) {
        throw new AssistantAccessRefusal(
          `${action} failed: HTTP ${status}`,
          code,
          status,
          names,
        );
      }
      throw new AssistantAccessRefusal(
        `${action} failed: could not reach the API.`,
        null,
        null,
      );
    }
    const entity = map(unwrapEnvelope(res.data));
    if (!entity) {
      throw new AssistantAccessRefusal(`${action} returned no data`, null, null);
    }
    return entity;
  }
}
