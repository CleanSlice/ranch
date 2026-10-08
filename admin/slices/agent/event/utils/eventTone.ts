/**
 * The one place an event's `outcome`, an event's `status` and an incident's
 * `notifications[]` are turned into a label and a tone (docs/state.md, "one
 * fact, one derivation"). The list, the agent section, the open-incidents
 * block and the "Not notified" filter all read these, so they cannot disagree.
 *
 * No Vue in here: pure, tested beside the module.
 */
import type {
  IIncidentNotification,
  IncidentNotificationKindTypes,
} from '../domain/agentEvent.types';

export type EventTone = 'danger' | 'warning' | 'success' | 'muted';

export interface IToneLabel {
  label: string;
  tone: EventTone;
}

/** Badge classes per tone — shared by every badge in the slice. */
export const TONE_CLASSES: Record<EventTone, string> = {
  danger:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
  warning:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  muted: 'border-border bg-muted text-muted-foreground',
};

const OUTCOMES: Record<string, IToneLabel> = {
  opened: { label: 'Opened an incident', tone: 'danger' },
  joined: { label: 'Same incident', tone: 'muted' },
  suppressed_stopped: { label: 'Agent was stopped on purpose', tone: 'muted' },
  suppressed_starting: { label: 'Agent was being started', tone: 'muted' },
  unmatched: { label: 'Unknown agent', tone: 'warning' },
  evidence: { label: 'Recovery reported', tone: 'success' },
};

/** Every outcome the API documents today. */
export const KNOWN_OUTCOMES: readonly string[] = Object.keys(OUTCOMES);

/** What Ranch did with a report. An outcome this console does not know yet is
 *  shown raw — a blank badge would hide that something happened. */
export function outcomeTone(outcome: string): IToneLabel {
  return OUTCOMES[outcome] ?? { label: outcome, tone: 'muted' };
}

const STATUSES: Record<string, IToneLabel> = {
  failed: { label: 'Failed', tone: 'danger' },
  unreachable: { label: 'Unreachable', tone: 'warning' },
  recovered: { label: 'Recovered', tone: 'success' },
};

/** What was reported about the agent. Unknown values are shown raw. */
export function statusTone(status: string): IToneLabel {
  return STATUSES[status] ?? { label: status, tone: 'muted' };
}

const RESOLUTIONS: Record<string, IToneLabel> = {
  recovered: { label: 'Recovered', tone: 'success' },
  // Only an outside sender ever saw it down; Ranch saw the agent running.
  unconfirmed: { label: 'No further reports', tone: 'muted' },
  stopped: { label: 'Agent stopped', tone: 'muted' },
  deleted: { label: 'Agent deleted', tone: 'muted' },
};

/**
 * Where an incident stands, in one badge: what is wrong while it is open,
 * "Recovering" once Ranch has seen the agent come up and is waiting out the
 * quiet period, and how it ended once it is closed.
 */
export function incidentTone(incident: {
  state: string;
  status: string;
  upSince: string | null;
  resolution: string | null;
}): IToneLabel {
  if (incident.state === 'open') {
    if (incident.upSince) return { label: 'Recovering', tone: 'warning' };
    return statusTone(incident.status);
  }
  const resolution = incident.resolution ?? '';
  return RESOLUTIONS[resolution] ?? { label: resolution || 'Closed', tone: 'muted' };
}

export interface IDeliveryState extends IToneLabel {
  state: IIncidentNotification['status'];
  /** The delivery error, as the server recorded it. Shown on hover. */
  detail?: string;
}

/**
 * Whether the team was told about an incident. `kind` picks which message —
 * the one sent when it opened (the default) or the one sent when it closed.
 * `null` when there is no such notification row: nothing to claim either way.
 */
export function deliveryState(
  notifications: readonly IIncidentNotification[] | null | undefined,
  kind: IncidentNotificationKindTypes = 'opened',
): IDeliveryState | null {
  const n = (notifications ?? []).find((item) => item.kind === kind);
  if (!n) return null;
  const detail = n.lastError ? { detail: n.lastError } : {};
  switch (n.status) {
    case 'sent':
      return { state: 'sent', label: 'Notified', tone: 'success' };
    case 'pending':
      return {
        state: 'pending',
        label: n.attempts > 0 ? `Retrying (${n.attempts})` : 'Sending',
        tone: 'warning',
        ...detail,
      };
    case 'failed':
      return { state: 'failed', label: 'Not delivered', tone: 'danger', ...detail };
    case 'skipped':
      return { state: 'skipped', label: 'No destination', tone: 'muted' };
    default:
      return { state: n.status, label: String(n.status), tone: 'muted' };
  }
}

/** Nobody outside the console heard about it: not delivered, or never sent. */
export function isNotNotified(delivery: IDeliveryState | null): boolean {
  return delivery !== null && (delivery.state === 'failed' || delivery.state === 'skipped');
}
