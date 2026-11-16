import { AgentLimitsService } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IAgentLimitGateway } from '../domain/agentLimit.gateway';
import {
  errorWithCode,
  type IAgentLimitSummary,
  type IAgentLimits,
  type IAgentLoad,
} from '../domain/agentLimit.types';
import { AgentLimitMapper } from './agentLimit.mapper';

interface HeyApiResult {
  data?: unknown;
  error?: unknown;
  response?: { status?: number };
}

/**
 * Hey API's axios client never throws: a failed call comes back as
 * `{ error, response }`, where `error` is the response body. The API does not
 * wrap error bodies in its `{ success, data }` envelope, so a refused save is
 * `error = { code, message }` — the `code` is kept on the Error thrown here
 * (`refusalCodeOf` reads it back). A network-level failure has no body at all:
 * `error` is then an empty object.
 */
function unwrap(res: HeyApiResult, action: string): unknown {
  const err = res.error;
  if (err !== undefined && err !== null) {
    const status = res.response?.status;
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message) throw errorWithCode(message, err);
    if (status && status >= 400) {
      throw errorWithCode(`${action} failed: HTTP ${status}`, err);
    }
    throw new Error(`${action} failed: could not reach the API.`);
  }
  return unwrapEnvelope(res.data);
}

export class AgentLimitGateway extends BaseGateway implements IAgentLimitGateway {
  private mapper = new AgentLimitMapper();

  summary(): Promise<IAgentLimitSummary[]> {
    return this.execute(async () => {
      const res = await AgentLimitsService.listAgentLimits();
      return this.mapper.toSummaryList(unwrap(res, 'Limits summary'));
    });
  }

  limits(agentId: string): Promise<IAgentLimits | null> {
    return this.execute(async () => {
      const res = await AgentLimitsService.getAgentLimits({ path: { agentId } });
      return this.mapper.toLimitsState(unwrap(res, 'Limits'));
    });
  }

  setLimits(
    agentId: string,
    limits: IAgentLimits | null,
  ): Promise<IAgentLimits | null> {
    return this.execute(async () => {
      const res = await AgentLimitsService.setAgentLimits({
        path: { agentId },
        body: this.mapper.toSetDto(limits),
      });
      return this.mapper.toLimitsState(unwrap(res, 'Saving limits'));
    });
  }

  load(agentId: string): Promise<IAgentLoad> {
    return this.execute(async () => {
      const res = await AgentLimitsService.getAgentLoad({ path: { agentId } });
      const load = this.mapper.toLoad(unwrap(res, 'Load'));
      if (!load) throw new Error('Load failed: the API returned no data.');
      return load;
    });
  }
}
