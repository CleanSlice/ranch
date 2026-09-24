// A2A 0.3 on the wire (CLEAN-114).
//
// Ranch speaks 1.0 everywhere inside itself. Plenty of real agents do not:
// three of the public-registry agents probed on CLEAN-97 are 0.3, and so are
// the cards customers send us. This module is the whole of the old dialect —
// everything above it keeps reading 1.0 shapes.
//
// Two translations live here:
//
//  1. The card. A 0.3 card names one `url` at the top level, with an optional
//     `preferredTransport` and `additionalInterfaces[]`, where 1.0 has
//     `supportedInterfaces[]`. It is rewritten into the 1.0 shape as it is
//     read, keeping the version it declared — so a stored snapshot always has
//     the same shape, and the declared version is what later says which
//     dialect to speak.
//
//  2. The call. 0.3 names the method `message/send`, sends no version header,
//     spells roles `user`/`agent`, tags every part with a `kind`, and writes
//     task states as `input-required` rather than `TASK_STATE_INPUT_REQUIRED`.

import {
  A2A_JSONRPC_BINDING,
  A2aRoles,
  A2aTaskStates,
  selectJsonRpcInterface,
  type A2aPart,
  type A2aSendMessageResult,
  type A2aTaskState,
  type IA2aAgentCard,
  type IA2aAgentInterface,
  type IA2aArtifact,
  type IA2aMessage,
  type IA2aSendMessageParams,
  type IA2aTask,
} from './a2a.types';

/** The 0.3 method that does what 1.0 calls `SendMessage`. */
export const A2A_LEGACY_SEND_METHOD = 'message/send';

/** What a 0.3 card is assumed to speak when it does not say (spec default). */
export const A2A_LEGACY_VERSION = '0.3';

/** 0.3's default transport when `preferredTransport` is absent. */
const LEGACY_DEFAULT_TRANSPORT = 'JSONRPC';

export const A2aDialects = {
  /** `SendMessage`, the version header, ProtoJSON enums. */
  V1: 'v1',
  /** `message/send`, no header, lowercase enums, `kind` on every part. */
  Legacy: 'legacy',
} as const;

export type A2aDialect = (typeof A2aDialects)[keyof typeof A2aDialects];

/** One interface plus the dialect to speak to it. */
export interface ICallableInterface {
  iface: IA2aAgentInterface;
  dialect: A2aDialect;
}

/**
 * The interface delegation will dial, and how to talk to it. A JSON-RPC
 * interface on 1.0 wins; a JSON-RPC interface on anything else is the old
 * dialect. Import and delegation both come through here, so what the operator
 * approves is what gets called.
 */
export function selectCallableInterface(
  card: Pick<IA2aAgentCard, 'supportedInterfaces'> | null | undefined,
): ICallableInterface | null {
  const modern = selectJsonRpcInterface(card);
  if (modern) return { iface: modern, dialect: A2aDialects.V1 };

  const legacy = (card?.supportedInterfaces ?? []).find(
    (i) =>
      typeof i?.url === 'string' &&
      String(i.protocolBinding ?? '').toUpperCase() === A2A_JSONRPC_BINDING &&
      isLegacyVersion(i.protocolVersion),
  );
  return legacy ? { iface: legacy, dialect: A2aDialects.Legacy } : null;
}

/**
 * Old, not merely "not 1.0". Everything before 1.0 was 0.x and is close
 * enough to 0.3 to try; a version we have never heard of — a future 2.0 —
 * must be refused rather than guessed at, or we would send a 2.0 agent
 * messages shaped for a protocol it retired.
 */
export function isLegacyVersion(value: string | undefined | null): boolean {
  const version = String(value ?? '').trim();
  return version === '' || version.startsWith('0.');
}

/**
 * Whether a document is a 0.3 card: named, with skills, and reaching us with
 * a top-level `url` instead of `supportedInterfaces`.
 *
 * Deliberately lenient about the version (CLEAN-114). A strict reading would
 * demand `protocolVersion: "0.3.x"`, which rejects the very cards that
 * prompted this — the Adobe Learning Manager card declares no protocol
 * version at all. Accepting it costs us a failure at call time instead of at
 * import, and since CLEAN-97 those failures name their cause.
 */
export function isLegacyCardShape(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const card = value as Record<string, unknown>;
  return (
    typeof card.name === 'string' &&
    Array.isArray(card.skills) &&
    !Array.isArray(card.supportedInterfaces) &&
    typeof card.url === 'string' &&
    card.url.trim().length > 0
  );
}

/**
 * A 0.3 card in 1.0 clothes. The declared protocol version rides along on the
 * interface, which is what later tells `selectCallableInterface` to speak the
 * old dialect — nothing else has to remember where this card came from, and
 * no column had to be added to store it.
 */
export function normalizeLegacyCard(value: unknown): IA2aAgentCard | null {
  if (!isLegacyCardShape(value)) return null;
  const card = value as Record<string, unknown>;
  const version =
    typeof card.protocolVersion === 'string' && card.protocolVersion.trim()
      ? card.protocolVersion.trim()
      : A2A_LEGACY_VERSION;

  return {
    ...(card as unknown as IA2aAgentCard),
    supportedInterfaces: legacyInterfaces(card, version),
    capabilities: (card.capabilities as IA2aAgentCard['capabilities']) ?? {},
    defaultInputModes: stringList(
      card.defaultInputModes ?? card.default_input_modes,
    ),
    defaultOutputModes: stringList(
      card.defaultOutputModes ?? card.default_output_modes,
    ),
    description: typeof card.description === 'string' ? card.description : '',
    version: typeof card.version === 'string' ? card.version : '',
  };
}

/**
 * Every way in the 0.3 card says it can be reached, preferred one first. A
 * card that prefers gRPC may still offer JSON-RPC in `additionalInterfaces`,
 * and refusing it for the header line would be refusing an agent we can call.
 */
function legacyInterfaces(
  card: Record<string, unknown>,
  protocolVersion: string,
): IA2aAgentInterface[] {
  const preferred = {
    url: String(card.url),
    protocolBinding: transportName(card.preferredTransport),
    protocolVersion,
  };

  const extra = Array.isArray(card.additionalInterfaces)
    ? card.additionalInterfaces
        .filter(
          (i): i is Record<string, unknown> =>
            Boolean(i) && typeof i === 'object',
        )
        .filter((i) => typeof i.url === 'string' && i.url.trim().length > 0)
        .map((i) => ({
          url: String(i.url),
          protocolBinding: transportName(i.transport),
          protocolVersion,
        }))
    : [];

  // JSON-RPC first: `selectCallableInterface` takes the first match, and the
  // console shows the first interface when it finds no better one.
  const all = [preferred, ...extra];
  const jsonRpc = all.filter(
    (i) => i.protocolBinding.toUpperCase() === A2A_JSONRPC_BINDING,
  );
  const rest = all.filter(
    (i) => i.protocolBinding.toUpperCase() !== A2A_JSONRPC_BINDING,
  );
  return [...jsonRpc, ...rest];
}

function transportName(value: unknown): string {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : LEGACY_DEFAULT_TRANSPORT;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
}

// ── Outgoing ────────────────────────────────────────────────────

/** `message/send` params, built from what the 1.0 caller assembled. */
export function toLegacySendParams(
  params: IA2aSendMessageParams,
): Record<string, unknown> {
  const message = params.message;
  return {
    message: {
      kind: 'message',
      messageId: message.messageId,
      role: message.role === A2aRoles.Agent ? 'agent' : 'user',
      parts: (message.parts ?? []).map(toLegacyPart),
      ...(message.contextId ? { contextId: message.contextId } : {}),
      ...(message.taskId ? { taskId: message.taskId } : {}),
      ...(message.metadata ? { metadata: message.metadata } : {}),
    },
    configuration: {
      // 1.0 inverted this flag; 0.3 asks for the answer, not a task id.
      blocking: params.configuration?.returnImmediately !== true,
      acceptedOutputModes: params.configuration?.acceptedOutputModes ?? [
        'text/plain',
      ],
      ...(params.configuration?.historyLength !== undefined
        ? { historyLength: params.configuration.historyLength }
        : {}),
    },
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

function toLegacyPart(part: A2aPart): Record<string, unknown> {
  if ('text' in part) return { kind: 'text', text: part.text };
  if ('data' in part) return { kind: 'data', data: part.data };
  if ('url' in part) {
    return {
      kind: 'file',
      file: {
        uri: part.url,
        ...(part.filename ? { name: part.filename } : {}),
        ...(part.mediaType ? { mimeType: part.mediaType } : {}),
      },
    };
  }
  return {
    kind: 'file',
    file: {
      bytes: part.raw,
      ...(part.filename ? { name: part.filename } : {}),
      ...(part.mediaType ? { mimeType: part.mediaType } : {}),
    },
  };
}

// ── Incoming ────────────────────────────────────────────────────

/** 0.3 spells its states in kebab-case; 1.0 in ProtoJSON enum names. */
const LEGACY_STATES: Record<string, A2aTaskState> = {
  submitted: A2aTaskStates.Submitted,
  working: A2aTaskStates.Working,
  completed: A2aTaskStates.Completed,
  failed: A2aTaskStates.Failed,
  canceled: A2aTaskStates.Canceled,
  cancelled: A2aTaskStates.Canceled,
  rejected: A2aTaskStates.Rejected,
  'input-required': A2aTaskStates.InputRequired,
  'auth-required': A2aTaskStates.AuthRequired,
  unknown: A2aTaskStates.Unspecified,
};

/**
 * A 0.3 reply as the 1.0 domain objects the caller already knows how to read.
 * Returns null when the payload is neither a task nor a message, which the
 * client reports the same way it does for 1.0.
 */
export function fromLegacyResult(value: unknown): A2aSendMessageResult | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;

  if (result.status && typeof result.status === 'object') {
    return { task: toTask(result) };
  }
  if (Array.isArray(result.parts)) {
    return { message: toMessage(result) };
  }
  return null;
}

function toTask(raw: Record<string, unknown>): IA2aTask {
  const status = (raw.status ?? {}) as Record<string, unknown>;
  const statusMessage = status.message;

  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    contextId: typeof raw.contextId === 'string' ? raw.contextId : '',
    status: {
      state: toState(status.state),
      timestamp:
        typeof status.timestamp === 'string'
          ? status.timestamp
          : new Date().toISOString(),
      ...(statusMessage && typeof statusMessage === 'object'
        ? { message: toMessage(statusMessage as Record<string, unknown>) }
        : {}),
    },
    artifacts: Array.isArray(raw.artifacts)
      ? raw.artifacts
          .filter(
            (a): a is Record<string, unknown> =>
              Boolean(a) && typeof a === 'object',
          )
          .map(toArtifact)
      : [],
    history: Array.isArray(raw.history)
      ? raw.history
          .filter(
            (m): m is Record<string, unknown> =>
              Boolean(m) && typeof m === 'object',
          )
          .map(toMessage)
      : [],
    ...(raw.metadata && typeof raw.metadata === 'object'
      ? { metadata: raw.metadata as IA2aTask['metadata'] }
      : {}),
  };
}

function toState(value: unknown): A2aTaskState {
  if (typeof value !== 'string') return A2aTaskStates.Unspecified;
  // A 0.3 server that already answers in enum names is taken at its word.
  if (value.startsWith('TASK_STATE_')) return value as A2aTaskState;
  return LEGACY_STATES[value.trim().toLowerCase()] ?? A2aTaskStates.Unspecified;
}

function toArtifact(raw: Record<string, unknown>): IA2aArtifact {
  return {
    artifactId:
      typeof raw.artifactId === 'string'
        ? raw.artifactId
        : typeof raw.id === 'string'
          ? raw.id
          : '',
    parts: toParts(raw.parts),
    ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
    ...(typeof raw.description === 'string'
      ? { description: raw.description }
      : {}),
  };
}

function toMessage(raw: Record<string, unknown>): IA2aMessage {
  return {
    messageId: typeof raw.messageId === 'string' ? raw.messageId : '',
    role: raw.role === 'user' ? A2aRoles.User : A2aRoles.Agent,
    parts: toParts(raw.parts),
    ...(typeof raw.contextId === 'string' ? { contextId: raw.contextId } : {}),
    ...(typeof raw.taskId === 'string' ? { taskId: raw.taskId } : {}),
  };
}

function toParts(value: unknown): A2aPart[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((part) => toPart(part))
    .filter((part): part is A2aPart => part !== null);
}

/**
 * Tolerant on purpose. Servers calling themselves 0.3 differ on details — some
 * omit `kind`, some send a file with neither `uri` nor `bytes` — and a reply
 * we half understand beats "answered with something unreadable".
 */
function toPart(value: unknown): A2aPart | null {
  if (!value || typeof value !== 'object') return null;
  const part = value as Record<string, unknown>;

  if (typeof part.text === 'string') return { text: part.text };
  if (part.data !== undefined && part.data !== null) return { data: part.data };

  if (part.file && typeof part.file === 'object') {
    const file = part.file as Record<string, unknown>;
    const filename = typeof file.name === 'string' ? file.name : undefined;
    const mediaType =
      typeof file.mimeType === 'string' ? file.mimeType : undefined;
    if (typeof file.uri === 'string') {
      return { url: file.uri, filename, mediaType };
    }
    if (typeof file.bytes === 'string') {
      return { raw: file.bytes, filename, mediaType };
    }
  }
  return null;
}
