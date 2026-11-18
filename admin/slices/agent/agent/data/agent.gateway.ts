import { AgentsService, LogsService } from '#api/data';
import { client } from '#api/data/repositories/api/client.gen';
import { authedFetch } from '#auth/utils/authedFetch';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IAgentGateway } from '../domain/agent.gateway';
import { errorWithCode } from '../domain/agentLimit.types';
import type {
  IAgentData,
  IAgentEnvVar,
  IAgentMetrics,
  IClusterCapacityData,
  ICreateAgentData,
  IUpdateAgentData,
} from '../domain/agent.types';
import { AgentMapper } from './agent.mapper';

interface HeyApiResult {
  data?: unknown;
  error?: unknown;
  response?: { status?: number };
}

/**
 * Hey API's axios client never throws by default — it returns
 * `{ data, error, response }`, and on a network-level failure (no HTTP
 * response: CORS rejection, API down) it sets `error` to an empty `{}` that is
 * truthy but has no `.message`. Turn every failure mode into a meaningful Error
 * and return the unwrapped payload on success.
 */
function unwrapOrThrow(res: HeyApiResult, action: string): unknown {
  throwIfRefused(res, action);
  const payload = unwrapEnvelope(res.data);
  if (payload === null) throw new Error(`${action} failed: the API returned no data.`);
  return payload;
}

/**
 * The failure half of `unwrapOrThrow`, on its own for the routes that answer
 * 204 with no body (the pin): there, "no data" is the success.
 */
function throwIfRefused(res: HeyApiResult, action: string): void {
  const status = res.response?.status;
  const err = res.error;
  if (err !== undefined && err !== null) {
    const message = (err as { message?: string }).message;
    // `err` is the response body, which the API does not wrap for errors. A
    // refused save carries a `code` there (PUBLIC_AGENT_NEEDS_LIMITS, …,
    // CLEAN-224); it stays on the Error so the caller can word the refusal.
    if (message) throw errorWithCode(`${action} failed: ${message}`, err);
    if (status && status >= 400) {
      throw errorWithCode(`${action} failed: HTTP ${status}`, err);
    }
    throw new Error(
      `${action} failed: could not reach the API. Check that the API is ` +
        "running and that this app's origin is listed in CORS_ORIGIN.",
    );
  }
}

export class AgentGateway extends BaseGateway implements IAgentGateway {
  private mapper = new AgentMapper();

  findAll(): Promise<IAgentData[]> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerFindAll();
      // A refused or unreachable list is not an empty one. Answering `[]`
      // here made the store replace its collection with nothing on a failed
      // read: the rail emptied and the resolver offered "create your first
      // agent" to an operator whose request had merely failed (CLEAN-231,
      // twin of the app gateway). Thrown, the store keeps the rows it has.
      return this.mapper.toList(unwrapOrThrow(res, 'Agent list'));
    });
  }

  findById(id: string): Promise<IAgentData | null> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerFindById({ path: { id } });
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }

  findAdmin(): Promise<IAgentData | null> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerFindAdmin();
      // Three answers, and the caller tells them apart (CLEAN-231): the
      // agent, `null` when the installation has none yet, and a refusal.
      // 404 is the API saying this account does not reach the Ranch admin
      // agent, so the status stays on the error.
      const failure = (res as HeyApiResult).error;
      if (failure !== undefined && failure !== null) {
        const error = new Error('Ranch admin agent read failed') as Error & {
          status?: number;
        };
        error.status = (res as HeyApiResult).response?.status;
        throw error;
      }
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }

  create(input: ICreateAgentData): Promise<IAgentData> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerCreate({
        body: this.mapper.toCreateDto(input),
      });
      return this.entityOrThrow(unwrapOrThrow(res, 'Agent create'), 'Agent create');
    });
  }

  update(id: string, input: IUpdateAgentData): Promise<IAgentData> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerUpdate({
        path: { id },
        body: this.mapper.toUpdateDto(input),
      });
      return this.entityOrThrow(unwrapOrThrow(res, 'Agent update'), 'Agent update');
    });
  }

  // The caller's own pin (CLEAN-231): its own two routes, both answering 204
  // with no body. A refusal is thrown, so the store rolls the optimistic
  // flip back.
  setPinned(id: string, pinned: boolean): Promise<void> {
    return this.execute(async () => {
      const res = pinned
        ? await AgentsService.pinAgent({ path: { id } })
        : await AgentsService.unpinAgent({ path: { id } });
      throwIfRefused(res, pinned ? 'Pin' : 'Unpin');
    });
  }

  restart(id: string): Promise<IAgentData> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerRestart({ path: { id } });
      return this.entityOrThrow(unwrapOrThrow(res, 'Restart'), 'Restart');
    });
  }

  // Raw axios: the generated SDK hasn't been regenerated for stop/start/env/
  // metrics yet. `client.instance` carries the Bearer via the api interceptor.
  stop(id: string): Promise<IAgentData> {
    return this.execute(async () => {
      const res = await client.instance.post(`/agents/${id}/stop`);
      return this.entityOrThrow(unwrapEnvelope(res.data), 'Stop');
    });
  }

  start(id: string): Promise<IAgentData> {
    return this.execute(async () => {
      const res = await client.instance.post(`/agents/${id}/start`);
      return this.entityOrThrow(unwrapEnvelope(res.data), 'Start');
    });
  }

  // Raw fetch: the OpenAPI spec doesn't expose `wipeS3` as a typed query param.
  // `authedFetch` attaches the bearer and applies the same refresh-and-retry
  // rule the SDK's axios interceptor does.
  remove(id: string, wipeS3: boolean): Promise<void> {
    return this.execute(async () => {
      const runtime = useRuntimeConfig();
      const url = new URL(`${runtime.public.apiUrl}/agents/${id}`);
      if (wipeS3) url.searchParams.set('wipeS3', 'true');
      const res = await authedFetch(url.toString(), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(`Delete failed: ${res.status} ${res.statusText}`);
      }
    });
  }

  promoteAdmin(id: string): Promise<IAgentData> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerPromoteAdmin({ path: { id } });
      return this.entityOrThrow(unwrapEnvelope(res.data), 'Promote');
    });
  }

  demoteAdmin(id: string): Promise<IAgentData> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerDemoteAdmin({ path: { id } });
      return this.entityOrThrow(unwrapEnvelope(res.data), 'Demote');
    });
  }

  logs(id: string): Promise<string> {
    return this.execute(async () => {
      // `tail` is a required query param (last N lines); the old store omitted
      // it (a latent type error) and relied on the server default.
      const res = await LogsService.logControllerGetLogs({
        path: { agentId: id },
        query: { tail: '1000' },
      });
      const payload = unwrapEnvelope<{ logs?: string }>(res.data);
      return typeof payload?.logs === 'string' ? payload.logs : '';
    });
  }

  env(id: string): Promise<IAgentEnvVar[]> {
    return this.execute(async () => {
      const res = await client.instance.get(`/agents/${id}/env`);
      return this.mapper.toEnvVars(unwrapEnvelope(res.data));
    });
  }

  metrics(id: string): Promise<IAgentMetrics | null> {
    return this.execute(async () => {
      const res = await client.instance.get(`/agents/${id}/metrics`);
      return this.mapper.toMetrics(unwrapEnvelope(res.data));
    });
  }

  capacity(): Promise<IClusterCapacityData | null> {
    return this.execute(async () => {
      const res = await AgentsService.getClusterCapacity();
      return this.mapper.toCapacity(unwrapEnvelope(res.data));
    });
  }

  private entityOrThrow(payload: unknown, action: string): IAgentData {
    const entity = this.mapper.toEntity(payload);
    if (!entity) throw new Error(`${action} returned no agent data`);
    return entity;
  }
}
