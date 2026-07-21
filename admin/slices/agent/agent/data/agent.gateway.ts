import { AgentsService, LogsService } from '#api/data';
import { client } from '#api/data/repositories/api/client.gen';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IAgentGateway } from '../domain/agent.gateway';
import type {
  IAgentData,
  IAgentEnvVar,
  IAgentMetrics,
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
  const status = res.response?.status;
  const err = res.error;
  if (err !== undefined && err !== null) {
    const message = (err as { message?: string }).message;
    if (message) throw new Error(`${action} failed: ${message}`);
    if (status && status >= 400) throw new Error(`${action} failed: HTTP ${status}`);
    throw new Error(
      `${action} failed: could not reach the API. Check that the API is ` +
        "running and that this app's origin is listed in CORS_ORIGIN.",
    );
  }
  const payload = unwrapEnvelope(res.data);
  if (payload === null) throw new Error(`${action} failed: the API returned no data.`);
  return payload;
}

function readAccessToken(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export class AgentGateway extends BaseGateway implements IAgentGateway {
  private mapper = new AgentMapper();

  findAll(): Promise<IAgentData[]> {
    return this.execute(async () => {
      const res = await AgentsService.agentControllerFindAll();
      return this.mapper.toList(unwrapEnvelope(res.data));
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
  // Re-attach the Bearer from the access_token cookie ourselves (the same job
  // the SDK's axios interceptor does).
  remove(id: string, wipeS3: boolean): Promise<void> {
    return this.execute(async () => {
      const runtime = useRuntimeConfig();
      const url = new URL(`${runtime.public.apiUrl}/agents/${id}`);
      if (wipeS3) url.searchParams.set('wipeS3', 'true');
      const headers: Record<string, string> = {};
      const token = readAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(url.toString(), {
        method: 'DELETE',
        credentials: 'include',
        headers,
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

  private entityOrThrow(payload: unknown, action: string): IAgentData {
    const entity = this.mapper.toEntity(payload);
    if (!entity) throw new Error(`${action} returned no agent data`);
    return entity;
  }
}
