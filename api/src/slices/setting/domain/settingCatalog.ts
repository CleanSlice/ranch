import type { SettingValueTypes } from './setting.types';

/**
 * What a setting means, as the admin console's settings pages present it.
 *
 * Settings are free-form `group.name` rows, so an agent asked to "turn off
 * registration" has no way to learn that the key is `auth.registration_enabled`
 * — it would guess, and `upsert_setting` would happily save the guess as a
 * new row nothing reads (CLEAN-109). This catalogue is the list the console
 * pages under `admin/slices/setting/pages/settings/*.vue` read and write,
 * plus the `infrastructure` group the API seeds from env at boot. It is
 * descriptive, not a schema: unknown keys stay allowed, as they are in the
 * console, and the tools use it to name the nearest known key instead.
 */
export interface ISettingDefinition {
  group: string;
  name: string;
  valueType: SettingValueTypes;
  /** One line, in the words of the console page. */
  description: string;
  /**
   * The value reaches an agent pod as env at deploy time, so a running agent
   * keeps the old one until it restarts.
   */
  restartRequired: boolean;
  /** Password-type field in the console — a tool must never echo its value. */
  secret?: true;
}

/**
 * Every key on the ordering of the settings menu (Organization, Agent
 * defaults, Authentication, GitHub, Bridle, Knowledge, Rancher, Storage,
 * Secrets), then the boot-seeded infrastructure keys.
 */
export const SETTING_CATALOG: ISettingDefinition[] = [
  // ─── Organization ────────────────────────────────────────────────────
  {
    group: 'organization',
    name: 'name',
    valueType: 'string',
    description: 'Organization name shown across the admin UI.',
    restartRequired: false,
  },

  // ─── Agent defaults ──────────────────────────────────────────────────
  {
    group: 'agent_defaults',
    name: 'cpu',
    valueType: 'string',
    description:
      'Default CPU request for agent pods (e.g. 500m), applied when a ' +
      'template does not specify its own.',
    restartRequired: true,
  },
  {
    group: 'agent_defaults',
    name: 'memory',
    valueType: 'string',
    description:
      'Default memory request for agent pods (e.g. 512Mi), applied when a ' +
      'template does not specify its own.',
    restartRequired: true,
  },
  {
    group: 'agent_defaults',
    name: 'image',
    valueType: 'string',
    description:
      'Container image override for the built-in Rancher template, read when ' +
      'that template is first created.',
    restartRequired: true,
  },
  {
    group: 'a2a',
    name: 'agentSelfService',
    valueType: 'string',
    description:
      "'true' or 'false' — whether an agent asked in the chat may connect its " +
      "own peers (never another agent's). Off, only operators and operator " +
      'agents connect peers. Unset reads as on.',
    restartRequired: false,
  },

  // ─── Authentication ──────────────────────────────────────────────────
  {
    group: 'auth',
    name: 'registration_enabled',
    valueType: 'string',
    description:
      "'true' or 'false' — whether anyone can create a User account on the " +
      '/register page of the public app. Unset reads as off.',
    restartRequired: false,
  },

  // ─── GitHub ──────────────────────────────────────────────────────────
  {
    group: 'integrations',
    name: 'github_username',
    valueType: 'string',
    description: 'GitHub username the personal access token belongs to.',
    restartRequired: false,
  },
  {
    group: 'integrations',
    name: 'github_pat',
    valueType: 'string',
    description:
      'GitHub personal access token (scope read:packages) used to pull ' +
      'private images and to search skill repositories.',
    restartRequired: false,
    secret: true,
  },

  // ─── Bridle ──────────────────────────────────────────────────────────
  {
    group: 'integrations',
    name: 'bridle_url',
    valueType: 'string',
    description:
      'Bridle chat hub URL agents connect to on startup, including the ' +
      '/ws/agent namespace (default http://host.k3d.internal:3333/ws/agent).',
    restartRequired: true,
  },
  {
    group: 'integrations',
    name: 'bridle_api_key',
    valueType: 'string',
    description:
      'Shared secret agents send on the /ws/agent handshake; must match ' +
      'BRIDLE_API_KEY of the API.',
    restartRequired: true,
    secret: true,
  },

  // ─── Knowledge ───────────────────────────────────────────────────────
  {
    group: 'knowledge',
    name: 'enabled',
    valueType: 'json',
    description:
      'Boolean — whether the external knowledge (RAG) service is on. Off, the ' +
      '/knowledges API answers disabled and the admin hides knowledge pickers. ' +
      'Unset reads as on.',
    restartRequired: false,
  },
  {
    group: 'knowledge',
    name: 'url',
    valueType: 'string',
    description:
      'Knowledge service (LightRAG) URL, e.g. ' +
      'http://lightrag.platform.svc.cluster.local:9621.',
    restartRequired: false,
  },
  {
    group: 'knowledge',
    name: 'api_key',
    valueType: 'string',
    description: 'API key shared with the knowledge service.',
    restartRequired: false,
    secret: true,
  },
  {
    group: 'knowledge',
    name: 's3_bucket',
    valueType: 'string',
    description: 'S3 bucket that keeps knowledge source files.',
    restartRequired: false,
  },
  {
    group: 'knowledge',
    name: 'chat_credential_id',
    valueType: 'string',
    description:
      'Id of the LLM credential LightRAG uses for chat (LLM_BINDING / ' +
      'LLM_MODEL). Takes effect after the LightRAG container restarts.',
    restartRequired: false,
  },
  {
    group: 'knowledge',
    name: 'embedding_credential_id',
    valueType: 'string',
    description:
      'Id of the LLM credential LightRAG uses for embeddings ' +
      '(EMBEDDING_BINDING / EMBEDDING_MODEL). Takes effect after the ' +
      'LightRAG container restarts.',
    restartRequired: false,
  },
  {
    group: 'knowledge',
    name: 'ocr_enabled',
    valueType: 'json',
    description:
      'Boolean — recognise text in scanned PDFs with AWS Textract when a ' +
      'source is added. Off, a scanned PDF is recorded as failed. Unset reads ' +
      'as on.',
    restartRequired: false,
  },
  {
    group: 'knowledge',
    name: 'ocr_max_pages',
    valueType: 'json',
    description:
      'Number — page limit per PDF for OCR (default 500); a longer scan is ' +
      'skipped with a reason.',
    restartRequired: false,
  },

  // ─── Rancher ─────────────────────────────────────────────────────────
  {
    group: 'integrations',
    name: 'ranch_api_url',
    valueType: 'string',
    description:
      'Base URL of this API as seen from agent pods, injected as ' +
      'RANCH_API_URL (local k3d http://host.k3d.internal:3333, in-cluster ' +
      'http://ranch-api.platform.svc.cluster.local).',
    restartRequired: true,
  },

  // ─── Storage ─────────────────────────────────────────────────────────
  {
    group: 'integrations',
    name: 's3_bucket',
    valueType: 'string',
    description:
      'S3 bucket for agent persistence; when set, an agent syncs .agent/ to ' +
      'S3 on shutdown and restores on boot (prefix agents/{agent-id}).',
    restartRequired: true,
  },
  {
    group: 'integrations',
    name: 's3_endpoint',
    valueType: 'string',
    description:
      'S3 endpoint as the API reaches it (e.g. http://localhost:9000 for ' +
      'MinIO); blank for AWS.',
    restartRequired: true,
  },
  {
    group: 'integrations',
    name: 's3_endpoint_agent',
    valueType: 'string',
    description:
      'S3 endpoint as agent pods reach it (e.g. ' +
      'http://cleanslice-ranch-minio-1:9000); blank reuses s3_endpoint.',
    restartRequired: true,
  },
  {
    group: 'integrations',
    name: 'aws_region',
    valueType: 'string',
    description: 'AWS region for S3 and Textract (default us-east-1).',
    restartRequired: true,
  },
  {
    group: 'integrations',
    name: 'aws_access_key_id',
    valueType: 'string',
    description:
      'AWS access key id for S3 / Textract / Secrets Manager; blank on EKS ' +
      'to use the pod identity. Must be set together with the secret key.',
    restartRequired: true,
  },
  {
    group: 'integrations',
    name: 'aws_secret_access_key',
    valueType: 'string',
    description: 'AWS secret access key paired with aws_access_key_id.',
    restartRequired: true,
    secret: true,
  },

  // ─── Secrets ─────────────────────────────────────────────────────────
  {
    group: 'integrations',
    name: 'secret_provider',
    valueType: 'string',
    description:
      "Where agents keep user-scoped secrets: 'file' (JSON in the pod, dev " +
      "only) or 'aws' (AWS Secrets Manager under aws_secret_prefix).",
    restartRequired: true,
  },
  {
    group: 'integrations',
    name: 'aws_secret_prefix',
    valueType: 'string',
    description:
      'AWS Secrets Manager name prefix for user secrets, no trailing slash ' +
      '(e.g. cleanslice/users → cleanslice/users/<userId>).',
    restartRequired: true,
  },

  // ─── Infrastructure (seeded from env at boot, no console page) ───────
  {
    group: 'infrastructure',
    name: 'argo_url',
    valueType: 'string',
    description:
      'Argo Workflows server URL the API submits agent workflows to ' +
      '(env ARGO_WORKFLOWS_URL).',
    restartRequired: false,
  },
  {
    group: 'infrastructure',
    name: 'workflow_provider',
    valueType: 'string',
    description:
      "'argo' or 'mock' — how agent pods are launched (env WORKFLOW_PROVIDER).",
    restartRequired: false,
  },
  {
    group: 'infrastructure',
    name: 'agents_namespace',
    valueType: 'string',
    description:
      'Kubernetes namespace agent pods run in (env AGENTS_NAMESPACE, ' +
      'default agents).',
    restartRequired: false,
  },
  {
    group: 'infrastructure',
    name: 'kube_skip_tls_verify',
    valueType: 'string',
    description:
      "'true' to skip TLS verification against the cluster API " +
      '(env KUBE_INSECURE).',
    restartRequired: false,
  },
  {
    group: 'infrastructure',
    name: 'lightrag_url',
    valueType: 'string',
    description:
      'LightRAG URL fallback used by infrastructure config (env LIGHTRAG_URL); ' +
      'the Knowledge page sets knowledge.url instead.',
    restartRequired: false,
  },
  {
    group: 'infrastructure',
    name: 'lightrag_api_key',
    valueType: 'string',
    description:
      'LightRAG API key fallback (env LIGHTRAG_API_KEY); the Knowledge page ' +
      'sets knowledge.api_key instead.',
    restartRequired: false,
    secret: true,
  },
  {
    group: 'infrastructure',
    name: 'reins_bucket',
    valueType: 'string',
    description:
      'S3 bucket for knowledge source files at the infrastructure level ' +
      '(env REINS_S3_BUCKET).',
    restartRequired: false,
  },
  {
    group: 'infrastructure',
    name: 'api_public_url',
    valueType: 'string',
    description:
      'Public origin of this API for A2A agent cards and OAuth callbacks ' +
      '(env PUBLIC_API_URL); unset falls back to integrations.ranch_api_url.',
    restartRequired: false,
  },
];

export const settingKey = (group: string, name: string): string =>
  `${group}.${name}`;

export function findSettingDefinition(
  group: string,
  name: string,
): ISettingDefinition | null {
  return (
    SETTING_CATALOG.find((d) => d.group === group && d.name === name) ?? null
  );
}

/**
 * The catalogued key an unknown one most likely meant: same group, the most
 * characters shared at the start and the end (so a dropped middle like
 * `ocr_pages` → `ocr_max_pages` still lands), or one name containing the
 * other. Null when the group has no entries or nothing overlaps — a bare
 * guess would mislead more than no hint.
 */
export function nearestSettingDefinition(
  group: string,
  name: string,
): ISettingDefinition | null {
  const wanted = name.toLowerCase();
  let best: { def: ISettingDefinition; score: number } | null = null;
  for (const def of SETTING_CATALOG) {
    if (def.group !== group) continue;
    const known = def.name.toLowerCase();
    const shortest = Math.min(wanted.length, known.length);
    let score = Math.min(
      shortest,
      commonPrefixLength(wanted, known) + commonSuffixLength(wanted, known),
    );
    if (known.includes(wanted) || wanted.includes(known)) {
      score = Math.max(score, shortest);
    }
    if (score >= MIN_NEAR_SCORE && (!best || score > best.score)) {
      best = { def, score };
    }
  }
  return best?.def ?? null;
}

/** Two characters in common is a coincidence; three starts to be a key. */
const MIN_NEAR_SCORE = 3;

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

function commonSuffixLength(a: string, b: string): number {
  let i = 0;
  while (
    i < a.length &&
    i < b.length &&
    a[a.length - 1 - i] === b[b.length - 1 - i]
  ) {
    i += 1;
  }
  return i;
}

/**
 * The catalogue as text for a tool description, one line per key, grouped:
 * `group.name — meaning (string, restart required)`.
 */
export function describeSettingCatalog(): string {
  const groups = new Map<string, ISettingDefinition[]>();
  for (const def of SETTING_CATALOG) {
    const list = groups.get(def.group) ?? [];
    list.push(def);
    groups.set(def.group, list);
  }
  const sections: string[] = [];
  for (const [group, defs] of groups) {
    const lines = defs.map((d) => {
      const flags = [d.valueType, d.restartRequired ? 'restart required' : null]
        .filter((f): f is string => f !== null)
        .join(', ');
      return `${settingKey(d.group, d.name)} — ${d.description} (${flags})`;
    });
    sections.push(`[${group}]\n${lines.join('\n')}`);
  }
  return 'Known settings:\n' + sections.join('\n\n');
}
