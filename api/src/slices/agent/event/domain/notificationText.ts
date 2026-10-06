import {
  IClosedNotificationPayload,
  IOpenedNotificationPayload,
  QUIET_MS,
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
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
): INotificationMessage {
  const name = escapeSlack(payload.agentName);
  const headline = `Agent ${payload.status}: ${name}`;
  // An agent going down is the one message that should reach people who are
  // not looking: it mentions the whole channel. The mention is ours and sits
  // outside everything a sender supplied — their text is escaped, so a
  // `<!channel>` of their own stays plain characters. The closing message
  // does not mention anyone: good news can wait until someone looks.
  const lines = [`🔴 ${CHANNEL_MENTION} *${headline}*`];

  if (payload.reason) {
    lines.push(`*Cause:* ${escapeSlack(cut(payload.reason, REASON_SHOWN_MAX))}`);
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
      lines.push(`*Ranch sees:* ${escapeSlack(payload.ranchStatus)}${disagree}`);
    }
  }

  if (consoleUrl && payload.agentId) {
    lines.push(`<${agentEventsLink(consoleUrl, payload.agentId)}|Open in Ranch>`);
  }
  return message(headline, lines);
}

export function renderClosed(
  payload: IClosedNotificationPayload,
): INotificationMessage {
  const name = escapeSlack(payload.agentName);
  const stable = formatSpan(QUIET_MS);

  if (payload.resolution === 'recovered') {
    const down = formatSpan(
      new Date(payload.upAt).getTime() - new Date(payload.openedAt).getTime(),
    );
    const headline = `Agent back: ${name}`;
    return message(headline, [
      `🟢 *${headline}*`,
      `Down for ${down} (${slackDate(payload.openedAt)} → ${slackDate(payload.upAt)}), up and stable for ${stable}.`,
    ]);
  }

  const who = payload.firstSenderName
    ? escapeSlack(payload.firstSenderName)
    : 'An outside sender';
  const headline = `No further reports: ${name}`;
  return message(headline, [
    `🟢 *${headline}*`,
    `${who} reported a failure at ${slackDate(payload.openedAt)}. Ranch saw the agent running throughout, and nothing more has been reported for ${stable}.`,
  ]);
}

export function renderTest(): INotificationMessage {
  const text =
    'Test notification from Ranch — agent failure notifications will arrive here.';
  return message(text, [`✅ *Test notification from Ranch*`, 'Agent failure notifications will arrive here.']);
}
