import { UsersService } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IAgentAccessGateway } from '../domain/agentAccess.gateway';
import {
  AgentAccessRefusal,
  type IAgentAccessData,
  type ISetAgentAccessInput,
} from '../domain/agentAccess.types';
import { AgentAccessMapper } from './agentAccess.mapper';

interface HeyApiResult {
  data?: unknown;
  error?: unknown;
  response?: { status?: number };
}

export class AgentAccessGateway extends BaseGateway implements IAgentAccessGateway {
  private mapper = new AgentAccessMapper();

  get(userId: string): Promise<IAgentAccessData> {
    return this.execute(async () => {
      const res = await UsersService.getUserAgentAccess({ path: { id: userId } });
      return this.entityOrThrow(res, 'Reading agent access');
    });
  }

  set(userId: string, input: ISetAgentAccessInput): Promise<IAgentAccessData> {
    return this.execute(async () => {
      const res = await UsersService.setUserAgentAccess({
        path: { id: userId },
        body: this.mapper.toSetDto(input),
      });
      return this.entityOrThrow(res, 'Saving agent access');
    });
  }

  /**
   * Hey API's axios client never throws: a failed call comes back as
   * `{ error, response }`, where `error` is the response body. The API does
   * not wrap error bodies in its `{ success, data }` envelope, so a refusal
   * is `error = { code, message }`, with `outcome` next to them on
   * ACCESS_OPEN_NEEDS_CONFIRM. The sentence is kept as received. A
   * network-level failure has no body at all: `error` is then an empty
   * object.
   */
  private entityOrThrow(res: HeyApiResult, action: string): IAgentAccessData {
    const err = res.error;
    if (err !== undefined && err !== null) {
      const status = res.response?.status ?? null;
      const body = (typeof err === 'object' ? err : {}) as Record<string, unknown>;
      const code = typeof body.code === 'string' && body.code ? body.code : null;
      const outcome = this.mapper.toOutcome(body.outcome);
      if (typeof body.message === 'string' && body.message) {
        throw new AgentAccessRefusal(body.message, code, status, outcome);
      }
      if (status && status >= 400) {
        throw new AgentAccessRefusal(`${action} failed: HTTP ${status}`, code, status, outcome);
      }
      throw new AgentAccessRefusal(`${action} failed: could not reach the API.`, null, null);
    }
    const entity = this.mapper.toEntity(unwrapEnvelope(res.data));
    if (!entity) throw new AgentAccessRefusal(`${action} returned no data`, null, null);
    return entity;
  }
}
