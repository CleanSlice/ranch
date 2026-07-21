import type {
  CreateMcpServerDto,
  UpdateMcpServerDto,
} from '#api/data/repositories/api/types.gen';
import type {
  ICreateMcpServerData,
  IMcpServerData,
  IUpdateMcpServerData,
  McpServerAuthTypes,
  McpServerTransportTypes,
} from '../domain/mcpServer.types';

const TRANSPORTS = new Set<McpServerTransportTypes>(['streamableHttp', 'sse']);
const AUTH_TYPES = new Set<McpServerAuthTypes>(['none', 'bearer', 'header']);

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === 'string')
    : [];
}

// The generator types `description`/`authValue` as objects; they're really
// nullable strings. Coerce null→undefined and cast past the wrong DTO type.
function optStr<T>(value: string | null | undefined): T {
  return (value ?? undefined) as unknown as T;
}

/** Maps the MCP servers API onto domain shapes; reads defensively. */
export class McpServerMapper {
  toEntity(raw: unknown): IMcpServerData | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string') return null;
    return {
      id: o.id,
      name: str(o.name),
      description: nullableStr(o.description),
      url: str(o.url),
      transport: this.toTransport(o.transport),
      authType: this.toAuthType(o.authType),
      authValue: nullableStr(o.authValue),
      enabled: o.enabled === true,
      builtIn: o.builtIn === true,
      templateIds: strList(o.templateIds),
      createdAt: str(o.createdAt),
      updatedAt: str(o.updatedAt),
    };
  }

  toList(raw: unknown): IMcpServerData[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => this.toEntity(item))
      .filter((m): m is IMcpServerData => m !== null);
  }

  toCreateDto(input: ICreateMcpServerData): CreateMcpServerDto {
    return {
      name: input.name,
      description: optStr<CreateMcpServerDto['description']>(input.description),
      url: input.url,
      transport: input.transport,
      authType: input.authType,
      authValue: optStr<CreateMcpServerDto['authValue']>(input.authValue),
      enabled: input.enabled,
    };
  }

  toUpdateDto(input: IUpdateMcpServerData): UpdateMcpServerDto {
    return {
      name: input.name,
      description: optStr<UpdateMcpServerDto['description']>(input.description),
      url: input.url,
      transport: input.transport,
      authType: input.authType,
      authValue: optStr<UpdateMcpServerDto['authValue']>(input.authValue),
      enabled: input.enabled,
    };
  }

  private toTransport(raw: unknown): McpServerTransportTypes {
    return typeof raw === 'string' && TRANSPORTS.has(raw as McpServerTransportTypes)
      ? (raw as McpServerTransportTypes)
      : 'streamableHttp';
  }

  private toAuthType(raw: unknown): McpServerAuthTypes {
    return typeof raw === 'string' && AUTH_TYPES.has(raw as McpServerAuthTypes)
      ? (raw as McpServerAuthTypes)
      : 'none';
  }
}
