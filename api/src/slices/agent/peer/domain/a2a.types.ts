// Agent2Agent (A2A) protocol contract, version 1.0 (CLEAN-74).
//
// Hand-written from the normative proto of the published 1.0 spec rather than
// taken from `@a2a-js/sdk`: Ranch speaks three methods (card, SendMessage,
// GetTask) and the SDK's server half wants its own executor, task store and
// express wiring, which would fight this project's Nest guards and response
// interceptor. See specs/013-a2a-agent-peers/research.md R1.
//
// Names below are 1.0, NOT 0.3 — the version most tutorials still show. The
// differences that bite: the card has `supportedInterfaces[]` instead of a
// top-level `url`/`preferredTransport`, parts carry no `kind` discriminator,
// task states are ProtoJSON enum names (`TASK_STATE_*`) and roles are
// `ROLE_USER` / `ROLE_AGENT`.
//
// Pure types + constants: no Nest, no Prisma, no DTOs.

/** Protocol version this server speaks and requires from callers. */
export const A2A_VERSION = '1.0';

/** Header every 1.0 client must send. An absent header means 0.3 per spec. */
export const A2A_VERSION_HEADER = 'A2A-Version';

/** Spec-mandated discovery path, appended to an agent's A2A base URL. */
export const A2A_CARD_PATH = '.well-known/agent-card.json';

// ── Agent card ──────────────────────────────────────────────────

/** One way to reach the agent. The first entry is the preferred one. */
export interface IA2aAgentInterface {
  url: string;
  /** 'JSONRPC' | 'GRPC' | 'HTTP+JSON', or a URI for a custom binding. */
  protocolBinding: string;
  /** Major.Minor only — never a patch. */
  protocolVersion: string;
  tenant?: string;
}

export interface IA2aAgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  extensions?: unknown[];
  extendedAgentCard?: boolean;
}

/** One thing the agent can do, written so another agent can decide when to ask. */
export interface IA2aAgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface IA2aAgentProvider {
  organization: string;
  url?: string;
}

/**
 * The public description of one agent as another agent reads it. Ranch derives
 * it on every read from the agent, its template skills and its bound knowledge
 * bases — it is never stored, except as the snapshot a peer connection keeps.
 * It deliberately says nothing about the agent's own peers (spec FR-019).
 */
export interface IA2aAgentCard {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: IA2aAgentInterface[];
  capabilities: IA2aAgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: IA2aAgentSkill[];
  securitySchemes?: Record<string, unknown>;
  securityRequirements?: unknown[];
  provider?: IA2aAgentProvider;
  documentationUrl?: string;
  iconUrl?: string;
}

// ── Messages and parts ──────────────────────────────────────────

/**
 * A part is a oneof on the key that is present — 1.0 removed the `kind`
 * discriminator 0.3 had. Ranch only ever sends and accepts text parts.
 */
export interface IA2aTextPart {
  text: string;
  metadata?: Record<string, unknown>;
  mediaType?: string;
  filename?: string;
}

export interface IA2aRawPart {
  raw: string;
  metadata?: Record<string, unknown>;
  mediaType?: string;
  filename?: string;
}

export interface IA2aUrlPart {
  url: string;
  metadata?: Record<string, unknown>;
  mediaType?: string;
  filename?: string;
}

export interface IA2aDataPart {
  data: unknown;
  metadata?: Record<string, unknown>;
  mediaType?: string;
  filename?: string;
}

export type A2aPart = IA2aTextPart | IA2aRawPart | IA2aUrlPart | IA2aDataPart;

export const A2aRoles = {
  User: 'ROLE_USER',
  Agent: 'ROLE_AGENT',
} as const;

export type A2aRole = (typeof A2aRoles)[keyof typeof A2aRoles];

export interface IA2aMessage {
  messageId: string;
  role: A2aRole;
  parts: A2aPart[];
  contextId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  extensions?: string[];
  referenceTaskIds?: string[];
}

export interface IA2aArtifact {
  artifactId: string;
  parts: A2aPart[];
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  extensions?: string[];
}

// ── Tasks ───────────────────────────────────────────────────────

/** ProtoJSON enum names, which is what 1.0 puts on the wire. */
export const A2aTaskStates = {
  Unspecified: 'TASK_STATE_UNSPECIFIED',
  Submitted: 'TASK_STATE_SUBMITTED',
  Working: 'TASK_STATE_WORKING',
  Completed: 'TASK_STATE_COMPLETED',
  Failed: 'TASK_STATE_FAILED',
  Canceled: 'TASK_STATE_CANCELED',
  InputRequired: 'TASK_STATE_INPUT_REQUIRED',
  Rejected: 'TASK_STATE_REJECTED',
  AuthRequired: 'TASK_STATE_AUTH_REQUIRED',
} as const;

export type A2aTaskState = (typeof A2aTaskStates)[keyof typeof A2aTaskStates];

export interface IA2aTaskStatus {
  state: A2aTaskState;
  message?: IA2aMessage;
  /** ISO 8601 UTC with a trailing Z. */
  timestamp: string;
}

/**
 * Ranch-specific task metadata, carried under `metadata.ranch` so it never
 * collides with another implementation's keys. `chain` is what makes the loop
 * and depth rules possible: every hop appends its own agent id.
 */
export interface IRanchTaskMetadata {
  chain: string[];
  reason?: string;
  rejection?: 'loop' | 'depth';
  failure?: 'not_running' | 'timeout';
  durationMs?: number;
}

export interface IA2aTask {
  id: string;
  contextId: string;
  status: IA2aTaskStatus;
  artifacts: IA2aArtifact[];
  history: IA2aMessage[];
  metadata?: { ranch?: IRanchTaskMetadata } & Record<string, unknown>;
}

// ── Method params ───────────────────────────────────────────────

export interface IA2aSendMessageConfiguration {
  acceptedOutputModes?: string[];
  historyLength?: number;
  /** 1.0 replaced 0.3's `blocking` with this inverted flag; default false. */
  returnImmediately?: boolean;
}

export interface IA2aSendMessageParams {
  message: IA2aMessage;
  configuration?: IA2aSendMessageConfiguration;
  metadata?: Record<string, unknown>;
  tenant?: string;
}

export interface IA2aGetTaskParams {
  id: string;
  historyLength?: number;
}

/** A blocking SendMessage answers with a task; the message form is unused here. */
export type A2aSendMessageResult =
  | { task: IA2aTask }
  | { message: IA2aMessage };

export const A2aMethods = {
  SendMessage: 'SendMessage',
  SendStreamingMessage: 'SendStreamingMessage',
  GetTask: 'GetTask',
  ListTasks: 'ListTasks',
  CancelTask: 'CancelTask',
  SubscribeToTask: 'SubscribeToTask',
  CreateTaskPushNotificationConfig: 'CreateTaskPushNotificationConfig',
  GetTaskPushNotificationConfig: 'GetTaskPushNotificationConfig',
  ListTaskPushNotificationConfigs: 'ListTaskPushNotificationConfigs',
  DeleteTaskPushNotificationConfig: 'DeleteTaskPushNotificationConfig',
  GetExtendedAgentCard: 'GetExtendedAgentCard',
} as const;

export type A2aMethod = (typeof A2aMethods)[keyof typeof A2aMethods];

/** Every method name the spec defines — used to tell "not supported" apart
 *  from "no such method". */
export const A2A_KNOWN_METHODS: readonly string[] = Object.values(A2aMethods);

// ── JSON-RPC envelope ───────────────────────────────────────────

export type JsonRpcId = string | number | null;

export interface IJsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface IJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface IJsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: IJsonRpcError;
}

/** Standard JSON-RPC codes plus the A2A-specific ones (spec §5.4). */
export const A2aErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  Internal: -32603,
  TaskNotFound: -32001,
  TaskNotCancelable: -32002,
  PushNotificationNotSupported: -32003,
  UnsupportedOperation: -32004,
  ContentTypeNotSupported: -32005,
  InvalidAgentResponse: -32006,
  ExtendedAgentCardNotConfigured: -32007,
  ExtensionSupportRequired: -32008,
  VersionNotSupported: -32009,
} as const;

export type A2aErrorCode = (typeof A2aErrorCodes)[keyof typeof A2aErrorCodes];

/** Thrown inside the A2A server; the controller turns it into a JSON-RPC error. */
export class A2aRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'A2aRpcError';
  }
}

// ── Helpers ─────────────────────────────────────────────────────

export function isTextPart(part: A2aPart): part is IA2aTextPart {
  return typeof (part as IA2aTextPart).text === 'string';
}

/** Every text part joined by a blank line; non-text parts are ignored. */
export function textOfParts(parts: A2aPart[] | undefined): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(isTextPart)
    .map((p) => p.text)
    .join('\n\n');
}

/** True when any part is something this server cannot read. */
export function hasNonTextPart(parts: A2aPart[] | undefined): boolean {
  if (!Array.isArray(parts)) return false;
  return parts.some((p) => !isTextPart(p));
}

/** The only transport Ranch calls peers over. */
export const A2A_JSONRPC_BINDING = 'JSONRPC';

/**
 * The interface Ranch talks to on a card: the first JSON-RPC one on the
 * protocol version this server speaks (CLEAN-97).
 *
 * A card lists interfaces in preference order, but "preferred" is the
 * agent's view, not ours: an agent that prefers HTTP+JSON and also offers
 * JSON-RPC is perfectly reachable. Import, delegation and the console's
 * address line all go through here, so what an operator approves is what
 * the delegation dials.
 */
/**
 * The least a document must have to be treated as a 1.0 card: a name, skills
 * to advertise, and at least one way to be reached. Everything else a card
 * carries is optional in practice, and refusing on it would refuse agents
 * that work.
 */
export function isA2aCardShape(value: unknown): value is IA2aAgentCard {
  if (!value || typeof value !== 'object') return false;
  const card = value as Record<string, unknown>;
  return (
    typeof card.name === 'string' &&
    Array.isArray(card.skills) &&
    Array.isArray(card.supportedInterfaces) &&
    card.supportedInterfaces.length > 0
  );
}

export function selectJsonRpcInterface(
  card: Pick<IA2aAgentCard, 'supportedInterfaces'> | null | undefined,
): IA2aAgentInterface | null {
  const interfaces = card?.supportedInterfaces;
  if (!Array.isArray(interfaces)) return null;
  return (
    interfaces.find(
      (i) =>
        typeof i?.url === 'string' &&
        String(i.protocolBinding ?? '').toUpperCase() === A2A_JSONRPC_BINDING &&
        i.protocolVersion === A2A_VERSION,
    ) ?? null
  );
}

/**
 * A peer's reply as text the calling model can read (CLEAN-97).
 *
 * Text parts pass through. Structured data is handed over as compact JSON
 * rather than dropped — for many agents the data IS the answer, and a model
 * reads JSON well. Links stay links. Binary payloads are named but not
 * inlined: base64 in a prompt costs tokens and tells the model nothing.
 */
export function renderReplyParts(parts: A2aPart[] | undefined): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => renderReplyPart(part))
    .filter((chunk) => chunk.length > 0)
    .join('\n\n');
}

function renderReplyPart(part: A2aPart): string {
  if (!part || typeof part !== 'object') return '';
  if (isTextPart(part)) return part.text.trim();

  if ('data' in part && part.data !== undefined && part.data !== null) {
    try {
      const json = JSON.stringify(part.data);
      return json === '{}' || json === '[]' ? '' : json;
    } catch {
      return '';
    }
  }

  if ('url' in part && typeof part.url === 'string' && part.url) {
    return part.filename ? `${part.filename}: ${part.url}` : part.url;
  }

  if ('raw' in part && typeof part.raw === 'string' && part.raw) {
    const label = part.filename ?? part.mediaType ?? 'unnamed file';
    return `[binary attachment not included: ${label}]`;
  }

  return '';
}

/**
 * The reply carried by a finished task. Artifacts are the answer; when a
 * peer leaves them empty and puts its words in the status message instead —
 * a pattern real agents use — that message is the answer. Empty string only
 * when neither says anything.
 */
export function replyTextOfTask(task: IA2aTask): string {
  const fromArtifacts = (task.artifacts ?? [])
    .map((artifact) => renderReplyParts(artifact?.parts))
    .filter((chunk) => chunk.length > 0)
    .join('\n\n');
  if (fromArtifacts) return fromArtifacts;
  return renderReplyParts(task.status?.message?.parts);
}

/** ISO 8601 UTC with the trailing Z the spec asks for. */
export function a2aTimestamp(at: Date = new Date()): string {
  return at.toISOString();
}
