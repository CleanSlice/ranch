import type { IBridleThinkingStep } from '#/bridle/domain/bridle.types';
import {
  DELEGATION_STEP_PREFIX,
  DelegationErrorCodes,
  DelegationStatuses,
  type DelegationErrorCode,
  type IAgentDelegationData,
} from './peer.types';

/**
 * The delegation as the person watching the chat sees it (CLEAN-74, FR-013).
 *
 * Two audiences, one object. The admin chat reads `kind` and `delegation` and
 * draws the peer, the matched skills, the reason and a running clock. Every
 * other surface — the user console, the embed, anything that renders a plain
 * thinking step — reads `label` and `detail`, so the same story has to survive
 * in words alone. That is why `detail` repeats what the structured fields say
 * instead of pointing at them.
 */

/** Product wording for every way a delegation can fail. Never raw error text:
 *  this string is read by someone who did not ask for a peer to exist. */
const CAUSES: Record<DelegationErrorCode, string> = {
  [DelegationErrorCodes.NotRunning]: 'it is not running',
  [DelegationErrorCodes.Timeout]: 'it did not answer in time',
  [DelegationErrorCodes.RejectedLoop]:
    'it refused: the request would loop back to an agent already involved',
  [DelegationErrorCodes.RejectedDepth]:
    'it refused: the chain of agents is already as long as it may get',
  [DelegationErrorCodes.Unauthorized]:
    'it refused the credential — the connection may have been removed',
  [DelegationErrorCodes.Unreachable]: 'it could not be reached',
  [DelegationErrorCodes.Error]: 'it answered with an error',
};

export function causeText(code: DelegationErrorCode | null): string {
  return code ? CAUSES[code] : 'it did not answer';
}

export function delegationStepId(delegationId: string): string {
  return `${DELEGATION_STEP_PREFIX}${delegationId}`;
}

function seconds(ms: number | null): string {
  if (ms === null) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function labelFor(row: IAgentDelegationData): string {
  switch (row.status) {
    case DelegationStatuses.Answered:
      return `Answered by «${row.peerName}»`;
    case DelegationStatuses.Rejected:
      return `«${row.peerName}» refused the task`;
    case DelegationStatuses.Failed:
      return `Could not reach «${row.peerName}»`;
    default:
      return `Asking «${row.peerName}»`;
  }
}

/** Markdown, because that is what a thinking step's detail is rendered as. */
function detailFor(row: IAgentDelegationData): string {
  const skills = row.matchedSkills.map((s) => s.name).join(', ');
  const lines = [
    `**Peer:** ${row.peerName}${skills ? ` — ${skills}` : ''}`,
    `**Why:** ${row.reason}`,
    `**Task:** ${row.task}`,
  ];

  if (row.status === DelegationStatuses.Waiting) {
    lines.push('**Status:** waiting for an answer…');
    return lines.join('\n\n');
  }

  const took = seconds(row.durationMs);
  if (row.status === DelegationStatuses.Answered) {
    lines.push(`**Answered** in ${took}`);
    if (row.excerpt) lines.push(row.excerpt);
    return lines.join('\n\n');
  }

  lines.push(`**Failed** after ${took}: ${causeText(row.errorCode)}`);
  return lines.join('\n\n');
}

export function buildDelegationStep(
  row: IAgentDelegationData,
): IBridleThinkingStep {
  const waiting = row.status === DelegationStatuses.Waiting;
  return {
    id: delegationStepId(row.id),
    label: labelFor(row),
    detail: detailFor(row),
    // The same id twice: the second push replaces the first in place, which is
    // what turns "Asking…" into "Answered by…" rather than stacking two steps.
    state: waiting ? 'active' : 'done',
    kind: 'delegation',
    delegation: {
      delegationId: row.id,
      peerAgentId: row.peerAgentId,
      peerName: row.peerName,
      matchedSkills: row.matchedSkills,
      reason: row.reason,
      task: row.task,
      status: row.status,
      startedAt: new Date(row.startedAt).getTime(),
      ...(row.durationMs !== null ? { durationMs: row.durationMs } : {}),
      ...(row.status === DelegationStatuses.Answered
        ? row.excerpt
          ? { excerpt: row.excerpt }
          : {}
        : { excerpt: causeText(row.errorCode) }),
    },
  };
}
