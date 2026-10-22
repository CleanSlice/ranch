import {
  AgentEventWitnessTypes,
  IAgentIncidentData,
  IClosedNotificationPayload,
  INotificationPayload,
  IOpenedNotificationPayload,
  QUIET_MS,
  ROOT_REASON_MAX,
  SlackReactionTypes,
} from './agentEvent.types';
import { INotificationMessage } from './notifier';

// A Slack section holds 3000 characters; the cause is the only part of a
// message whose length a sender controls.
const REASON_SHOWN_MAX = 1500;

/** Slack's "notify everyone in this channel". */
export const CHANNEL_MENTION = '<!channel>';

/**
 * Slack reads `<…>` as a link or a command (`<!channel>`, `<http://x|label>`)
 * and `&` as the start of an entity. Escaping the three characters shows a
 * sender's text exactly as it was sent and lets it do nothing else.
 */
export function escapeSlack(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** A moment each reader sees in their own time zone; the ISO string is the fallback. */
function slackDate(iso: string): string {
  const unix = Math.floor(new Date(iso).getTime() / 1000);
  return `<!date^${unix}^{date_short_pretty} at {time}|${iso}>`;
}

/** "45 s", "16 min", "2 h 5 min", "3 d 4 h". */
export function formatSpan(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return minutes ? `${totalHours} h ${minutes} min` : `${totalHours} h`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours ? `${days} d ${hours} h` : `${days} d`;
}

/** The agent's Events section in the admin console. */
export function agentEventsLink(consoleUrl: string, agentId: string): string {
  return `${consoleUrl}/agents/${encodeURIComponent(agentId)}?tab=events`;
}

/**
 * "[dev-mazda] " at the start of a channel-level message, so a reader knows
 * which installation it came from (CLEAN-167). Escaped like any text that
 * is not ours; empty when no environment is set.
 */
function envLabel(environment: string | null | undefined): string {
  const trimmed = environment?.trim();
  return trimmed ? `[${escapeSlack(trimmed)}] ` : '';
}

function message(text: string, lines: string[]): INotificationMessage {
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
    ],
  };
}

export function renderOpened(
  payload: IOpenedNotificationPayload,
  consoleUrl: string | null,
  environment: string | null = null,
): INotificationMessage {
  const name = escapeSlack(payload.agentName);
  const headline = `${envLabel(environment)}Agent ${payload.status}: ${name}`;
  // An agent going down is the one message that should reach people who are
  // not looking: it mentions the whole channel. The mention is ours and sits
  // outside everything a sender supplied — their text is escaped, so a
  // `<!channel>` of their own stays plain characters. The closing message
  // does not mention anyone: good news can wait until someone looks.
  const lines = [`🔴 ${CHANNEL_MENTION} *${headline}*`];

  if (payload.reason) {
    lines.push(
      `*Cause:* ${escapeSlack(cut(payload.reason, REASON_SHOWN_MAX))}`,
    );
  }
  lines.push(`*When:* ${slackDate(payload.occurredAt)}`);

  if (payload.witness === 'ranch') {
    lines.push('*Reported by:* Ranch (its own watch)');
  } else {
    const via = payload.tool ? ` (via ${escapeSlack(payload.tool)})` : '';
    lines.push(`*Reported by:* ${escapeSlack(payload.senderName)}${via}`);
    if (payload.ranchStatus) {
      // An outside sender says down, Ranch's own watch says up: show both
      // and pick neither.
      const disagree =
        payload.ranchStatus === 'running' ? ' — the two disagree' : '';
      lines.push(
        `*Ranch sees:* ${escapeSlack(payload.ranchStatus)}${disagree}`,
      );
    }
  }

  if (consoleUrl && payload.agentId) {
    lines.push(
      `<${agentEventsLink(consoleUrl, payload.agentId)}|Open in Ranch>`,
    );
  }
  return message(headline, lines);
}

export function renderClosed(
  payload: IClosedNotificationPayload,
  environment: string | null = null,
): INotificationMessage {
  const name = escapeSlack(payload.agentName);
  const label = envLabel(environment);
  const stable = formatSpan(QUIET_MS);

  if (payload.resolution === 'recovered') {
    const down = formatSpan(
      new Date(payload.upAt).getTime() - new Date(payload.openedAt).getTime(),
    );
    const headline = `${label}Agent back: ${name}`;
    return message(headline, [
      `🟢 *${headline}*`,
      `Down for ${down} (${slackDate(payload.openedAt)} → ${slackDate(payload.upAt)}), up and stable for ${stable}.`,
    ]);
  }

  const who = payload.firstSenderName
    ? escapeSlack(payload.firstSenderName)
    : 'An outside sender';
  const headline = `${label}No further reports: ${name}`;
  return message(headline, [
    `🟢 *${headline}*`,
    `${who} reported a failure at ${slackDate(payload.openedAt)}. Ranch saw the agent running throughout, and nothing more has been reported for ${stable}.`,
  ]);
}

// ── The bot transport (CLEAN-165): one root per incident, replies in its thread ──

export interface IRootState {
  emoji: string;
  reaction: SlackReactionTypes;
  /** The state clause of the root line, e.g. "down since <time>". */
  clause: string;
}

/**
 * Which state the root shows, from the incident row as it is right now —
 * never from the previous text, so two deliveries landing out of order
 * cannot leave a stale line (research D6).
 */
export function rootStateOf(incident: IAgentIncidentData): IRootState {
  const iso = (d: Date) => slackDate(d.toISOString());
  if (incident.open) {
    const up = incident.upSince && incident.upSince > incident.lastFailureAt;
    return up
      ? {
          emoji: '🟢',
          reaction: 'large_green_circle',
          clause: `up, watching since ${iso(incident.upSince!)}`,
        }
      : {
          emoji: '🔴',
          reaction: 'red_circle',
          clause: `down since ${iso(incident.openedAt)}`,
        };
  }
  const closedAt = incident.closedAt ?? incident.lastFailureAt;
  switch (incident.resolution) {
    case 'recovered': {
      const upAt =
        incident.upSince && incident.upSince > incident.lastFailureAt
          ? incident.upSince
          : incident.lastFailureAt;
      const down = formatSpan(upAt.getTime() - incident.openedAt.getTime());
      return {
        emoji: '✅',
        reaction: 'white_check_mark',
        clause: `resolved ${iso(closedAt)} · downtime ${down}`,
      };
    }
    case 'stopped':
      return {
        emoji: '⏹',
        reaction: 'black_square_for_stop',
        clause: `stopped by owner ${iso(closedAt)}`,
      };
    case 'deleted':
      return {
        emoji: '⏹',
        reaction: 'black_square_for_stop',
        clause: `deleted ${iso(closedAt)}`,
      };
    default:
      return {
        emoji: '🟢',
        reaction: 'large_green_circle',
        clause: `quiet since ${iso(incident.lastFailureAt)}, unconfirmed`,
      };
  }
}

/**
 * The one line in the channel. `mention` only for the very first post: a
 * rewrite never pings, and a mention left in the text would keep its
 * highlight after the alarm is over.
 */
export function renderRoot(
  incident: IAgentIncidentData,
  consoleUrl: string | null,
  options: { mention: boolean; environment?: string | null },
): INotificationMessage {
  const state = rootStateOf(incident);
  const label = envLabel(options.environment);
  const name = escapeSlack(incident.agentName);
  const parts = [
    `${label}${name} — incident #${incident.number}`,
    state.clause,
  ];
  if (incident.reason && incident.open) {
    parts.push(escapeSlack(cut(incident.reason, ROOT_REASON_MAX)));
  }
  if (incident.eventCount > 1) parts.push(`${incident.eventCount} reports`);
  const headline = parts.join(' · ');
  const mention = options.mention ? `${CHANNEL_MENTION} ` : '';
  const lines = [`${state.emoji} ${mention}*${headline}*`];
  if (consoleUrl && incident.agentId) {
    lines.push(
      `<${agentEventsLink(consoleUrl, incident.agentId)}|Open in Ranch>`,
    );
  }
  return message(`${label}${name} — incident #${incident.number}`, lines);
}

function reportedBy(payload: {
  witness: AgentEventWitnessTypes;
  senderName: string;
  tool: string | null;
  ranchStatus: string | null;
}): string[] {
  if (payload.witness === 'ranch') {
    return ['*Reported by:* Ranch (its own watch)'];
  }
  const via = payload.tool ? ` (via ${escapeSlack(payload.tool)})` : '';
  const lines = [`*Reported by:* ${escapeSlack(payload.senderName)}${via}`];
  if (payload.ranchStatus) {
    const disagree =
      payload.ranchStatus === 'running' ? ' — the two disagree' : '';
    lines.push(`*Ranch sees:* ${escapeSlack(payload.ranchStatus)}${disagree}`);
  }
  return lines;
}

/** One reply in the incident's thread, per outbox row. Never a mention. */
export function renderReply(
  payload: INotificationPayload,
): INotificationMessage {
  const name = escapeSlack(payload.agentName);
  switch (payload.kind) {
    case 'opened': {
      const lines = [`🔴 *Failed* — ${slackDate(payload.occurredAt)}`];
      if (payload.reason) {
        lines.push(
          `*Cause:* ${escapeSlack(cut(payload.reason, REASON_SHOWN_MAX))}`,
        );
      }
      lines.push(...reportedBy(payload));
      return message(`Failed: ${name}`, lines);
    }
    case 'joined': {
      const lines = [`🔴 *Failed again* — ${slackDate(payload.occurredAt)}`];
      if (payload.reason) {
        lines.push(
          `*Cause:* ${escapeSlack(cut(payload.reason, REASON_SHOWN_MAX))}`,
        );
      }
      const [by, ...rest] = reportedBy(payload);
      lines.push(`${by} · ${payload.eventCount} reports so far`, ...rest);
      return message(`Failed again: ${name}`, lines);
    }
    case 'running':
      return message(`Running again: ${name}`, [
        `🟢 *Running again* — ${slackDate(payload.at)}`,
        `Seen by Ranch. The incident closes after ${formatSpan(QUIET_MS)} without a further failure.`,
      ]);
    case 'closed': {
      const at = slackDate(payload.closedAt);
      switch (payload.resolution) {
        case 'recovered': {
          const down = formatSpan(
            new Date(payload.upAt).getTime() -
              new Date(payload.openedAt).getTime(),
          );
          return message(`Resolved: ${name}`, [
            `✅ *Resolved* — ${at}`,
            `Down for ${down} (${slackDate(payload.openedAt)} → ${slackDate(payload.upAt)}), up and stable for ${formatSpan(QUIET_MS)}.`,
          ]);
        }
        case 'stopped':
          return message(`Stopped: ${name}`, [
            `⏹ *Stopped by owner* — ${at}`,
            'Incident closed; nobody was paged.',
          ]);
        case 'deleted':
          return message(`Deleted: ${name}`, [
            `⏹ *Deleted* — ${at}`,
            `${name} was deleted; incident closed, nobody was paged.`,
          ]);
        default: {
          const who = payload.firstSenderName
            ? escapeSlack(payload.firstSenderName)
            : 'An outside sender';
          return message(`No further reports: ${name}`, [
            `🟢 *No further reports* — ${at}`,
            `${who} reported a failure at ${slackDate(payload.openedAt)}. Ranch saw the agent running throughout, and nothing more has been reported for ${formatSpan(QUIET_MS)}.`,
          ]);
        }
      }
    }
  }
}

export function renderTest(
  environment: string | null = null,
): INotificationMessage {
  const label = envLabel(environment);
  const text = `${label}Test notification from Ranch — agent failure notifications will arrive here.`;
  return message(text, [
    `✅ *${label}Test notification from Ranch*`,
    'Agent failure notifications will arrive here.',
  ]);
}
