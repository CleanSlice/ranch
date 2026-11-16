/**
 * The sentence a chat client gets when it cannot be told properly that the
 * agent's request limit is full (CLEAN-224): the embed widget before 0.16 and
 * older bundles send no acknowledgement id and know no `agent_limit` event,
 * so the refusal arrives as a line in the conversation, the same way "Agent
 * is not connected" always has.
 *
 * That client cannot count down, and the line stays on screen, so the wait is
 * rounded UP to something that is still true a while later: tens of seconds,
 * whole minutes, whole hours. English only — it is server text, shown as
 * received.
 */
export function limitFallbackLine(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  let wait: string;
  if (seconds < 60) {
    wait = `${Math.ceil(seconds / 10) * 10} seconds`;
  } else if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60);
    wait = minutes === 1 ? '1 minute' : `${minutes} minutes`;
  } else {
    const hours = Math.ceil(seconds / 3600);
    wait = hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return `This agent has reached its message limit. Try again in about ${wait}.`;
}
