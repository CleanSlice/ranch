import {
  AgentLimitsInput,
  IAgentLimits,
  LIMIT_MAX,
  LimitRefusalCode,
  LimitRefusalCodes,
  hasAnyLimit,
} from './agentLimit.types';

/**
 * Why a save of limits or of visibility was refused. Carries a code the
 * console maps to a sentence next to the field it concerns, and a message a
 * person can act on as it stands (the Ranch agent relays it verbatim).
 */
export class LimitRuleError extends Error {
  constructor(
    readonly code: LimitRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'LimitRuleError';
  }
}

const FIELDS: ReadonlyArray<[keyof IAgentLimits, string]> = [
  ['perMinute', 'per minute'],
  ['perHour', 'per hour'],
  ['perDay', 'per day'],
];

/**
 * Turn what a caller sent into limits, or null when every window is empty
 * ("limits off"). Absent, null and '' all mean "this window is not limited".
 */
export function normalizeLimits(
  input: AgentLimitsInput | null | undefined,
): IAgentLimits | null {
  const limits: IAgentLimits = { perMinute: null, perHour: null, perDay: null };
  if (!input) return null;
  for (const [field, label] of FIELDS) {
    const raw = input[field];
    if (raw === undefined || raw === null || raw === '') continue;
    if (
      typeof raw !== 'number' ||
      !Number.isInteger(raw) ||
      raw < 1 ||
      raw > LIMIT_MAX
    ) {
      throw new LimitRuleError(
        LimitRefusalCodes.OutOfRange,
        `The limit ${label} must be a whole number from 1 to ${LIMIT_MAX}.`,
      );
    }
    limits[field] = raw;
  }
  if (!hasAnyLimit(limits)) return null;

  // A longer window that allows fewer requests than a shorter one makes the
  // shorter limit unreachable: nobody could ever send that many.
  for (let i = 0; i < FIELDS.length; i++) {
    for (let j = i + 1; j < FIELDS.length; j++) {
      const [shorter, shorterLabel] = FIELDS[i];
      const [longer, longerLabel] = FIELDS[j];
      const a = limits[shorter];
      const b = limits[longer];
      if (a !== null && b !== null && b < a) {
        throw new LimitRuleError(
          LimitRefusalCodes.WindowsContradict,
          `The limit ${longerLabel} (${b}) is lower than the limit ${shorterLabel} (${a}), so the ${shorterLabel} limit could never be reached.`,
        );
      }
    }
  }
  return limits;
}

export interface ILimitChange {
  /** Present when the request sets the public flag. */
  isPublic?: boolean;
  /** Present (even as null) when the request sets limits. */
  limits?: AgentLimitsInput | null;
}

export interface ILimitChangeResult {
  /** True when the request set limits at all. */
  limitsTouched: boolean;
  /** The limits the agent ends up with. */
  limits: IAgentLimits | null;
}

/**
 * The one rule about visibility: a public agent has at least one limit.
 *
 * It is a rule on SAVING, not on existing. It applies when a request makes an
 * agent public or touches its limits; a request that does neither is never
 * refused. That is what lets an agent that was public before limits existed
 * keep working, and still be renamed, until someone opens its visibility
 * settings — whose save always carries limits.
 */
export function resolveLimitChange(
  current: { isPublic: boolean; limits: IAgentLimits | null },
  change: ILimitChange,
): ILimitChangeResult {
  const limitsTouched = change.limits !== undefined;
  const limits = limitsTouched
    ? normalizeLimits(change.limits)
    : current.limits;
  const becomesPublic = change.isPublic === true && !current.isPublic;
  const isPublic = change.isPublic ?? current.isPublic;

  if ((becomesPublic || limitsTouched) && isPublic && limits === null) {
    throw new LimitRuleError(
      LimitRefusalCodes.PublicAgentNeedsLimits,
      'A public agent needs at least one request limit. Set a limit, or make the agent private first.',
    );
  }
  return { limitsTouched, limits };
}
