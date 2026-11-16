/**
 * The three limit fields of the Request limit block, as pure functions
 * (CLEAN-224): text in the fields to limits and back, and a refused save to
 * the sentence shown next to the field it concerns.
 *
 * The rules themselves live on the server (`agentLimit.rules.ts` in `api`):
 * a whole number from 1 to 1 000 000, a longer window never lower than a
 * shorter one, a public agent with at least one limit. They are repeated here
 * only to answer at once and to know WHICH field a refusal is about — the
 * server's `code` names the rule, not the field.
 *
 * No Vue / Nuxt imports: this file runs under `bun test`.
 */
import {
  AgentLimitRefusalCodes,
  LIMIT_MAX,
  type IAgentLimits,
  type LimitWindowTypes,
} from '#agent/domain/agentLimit.types';
import { formatNumber } from '#common/utils/format';

/** What is typed in the three fields; an empty field is "not limited". */
export interface ILimitFormValues {
  minute: string;
  hour: string;
  day: string;
}

/** Where a refusal is shown: under one field, or under the group of three. */
export type LimitProblemPlace = LimitWindowTypes | 'limits';

export interface ILimitProblem {
  code: string;
  place: LimitProblemPlace;
  text: string;
}

export const LIMIT_FIELDS: ReadonlyArray<{
  window: LimitWindowTypes;
  key: keyof IAgentLimits;
  label: string;
}> = [
  { window: 'minute', key: 'perMinute', label: 'per minute' },
  { window: 'hour', key: 'perHour', label: 'per hour' },
  { window: 'day', key: 'perDay', label: 'per day' },
];

const DIGITS = /^[0-9]+$/;

export function limitsToForm(
  limits: IAgentLimits | null | undefined,
): ILimitFormValues {
  const text = (value: number | null | undefined) =>
    typeof value === 'number' ? String(value) : '';
  return {
    minute: text(limits?.perMinute),
    hour: text(limits?.perHour),
    day: text(limits?.perDay),
  };
}

/** `null` for an empty field, `undefined` for text that is not a valid limit. */
export function parseLimitField(text: string): number | null | undefined {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  if (!DIGITS.test(trimmed)) return undefined;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1 || value > LIMIT_MAX) {
    return undefined;
  }
  return value;
}

/** True when nothing is typed in any of the three fields. */
export function isLimitFormEmpty(values: ILimitFormValues): boolean {
  return !values.minute.trim() && !values.hour.trim() && !values.day.trim();
}

function outOfRangeText(): string {
  return `Enter a whole number from 1 to ${formatNumber(LIMIT_MAX)}, or leave the field empty for no limit.`;
}

function needsLimitsText(): string {
  return 'A public agent needs at least one limit. Fill in a limit, or keep the agent private.';
}

/**
 * The first rule the fields break, or `null`. Checked in the server's order:
 * range, then contradiction, then "public needs one".
 */
export function findLimitProblem(
  values: ILimitFormValues,
  isPublic: boolean,
): ILimitProblem | null {
  const parsed: Array<number | null | undefined> = [];
  for (let i = 0; i < LIMIT_FIELDS.length; i += 1) {
    const field = LIMIT_FIELDS[i]!;
    const value = parseLimitField(values[field.window]);
    if (value === undefined) {
      return {
        code: AgentLimitRefusalCodes.OutOfRange,
        place: field.window,
        text: outOfRangeText(),
      };
    }
    parsed.push(value);
  }

  // A longer window lower than a shorter one: shown under the longer field,
  // the one whose number has to go up.
  for (let i = 0; i < LIMIT_FIELDS.length; i += 1) {
    for (let j = i + 1; j < LIMIT_FIELDS.length; j += 1) {
      const shorter = parsed[i];
      const longer = parsed[j];
      if (
        typeof shorter === 'number' &&
        typeof longer === 'number' &&
        longer < shorter
      ) {
        const a = LIMIT_FIELDS[i]!;
        const b = LIMIT_FIELDS[j]!;
        return {
          code: AgentLimitRefusalCodes.WindowsContradict,
          place: b.window,
          text: `The limit ${b.label} (${formatNumber(longer)}) is lower than the limit ${a.label} (${formatNumber(shorter)}), so the ${a.label} limit could never be reached. Raise this one or lower the other.`,
        };
      }
    }
  }

  if (isPublic && isLimitFormEmpty(values)) {
    return {
      code: AgentLimitRefusalCodes.PublicAgentNeedsLimits,
      place: 'limits',
      text: needsLimitsText(),
    };
  }
  return null;
}

/**
 * The limits the fields describe: `null` when all three are empty ("limits
 * off"). Only meaningful once `findLimitProblem` found nothing — an unreadable
 * field counts as empty here.
 */
export function formToLimits(values: ILimitFormValues): IAgentLimits | null {
  if (isLimitFormEmpty(values)) return null;
  const limits: IAgentLimits = { perMinute: null, perHour: null, perDay: null };
  for (let i = 0; i < LIMIT_FIELDS.length; i += 1) {
    const field = LIMIT_FIELDS[i]!;
    limits[field.key] = parseLimitField(values[field.window]) ?? null;
  }
  return limits;
}

/**
 * A save the SERVER refused, as the sentence and the field it belongs to.
 * `null` for a code that is not about limits — the caller shows that failure
 * as a plain error instead.
 *
 * The field is worked out from what is in the form; when the form looks fine
 * to this file and the server still said no, the sentence goes under the
 * group, and the server's own message is used for the two rules whose wording
 * depends on the numbers.
 */
export function placeRefusal(
  code: string | null,
  message: string,
  values: ILimitFormValues,
  isPublic: boolean,
): ILimitProblem | null {
  if (
    code !== AgentLimitRefusalCodes.PublicAgentNeedsLimits &&
    code !== AgentLimitRefusalCodes.OutOfRange &&
    code !== AgentLimitRefusalCodes.WindowsContradict
  ) {
    return null;
  }
  const local = findLimitProblem(values, isPublic);
  if (local && local.code === code) return local;
  if (code === AgentLimitRefusalCodes.PublicAgentNeedsLimits) {
    return { code, place: 'limits', text: needsLimitsText() };
  }
  if (code === AgentLimitRefusalCodes.OutOfRange) {
    return { code, place: 'limits', text: outOfRangeText() };
  }
  return { code, place: 'limits', text: message };
}

/**
 * Where the Overview page shows a refusal (CLEAN-228): the limit places above,
 * plus the landing-page switch.
 */
export type RefusalPlace = LimitProblemPlace | 'public';

export interface IPlacedRefusal {
  code: string;
  place: RefusalPlace;
  text: string;
}

/**
 * `placeRefusal` for a page with one save for every block: the same sentence
 * can belong in two places. "A public agent needs a limit" is said in the
 * limit block AND by the landing-page switch — either one fixes it, and the
 * operator may be looking at the other. The two limit rules stay by their
 * field. Empty for a code that is not about limits.
 */
export function placeRefusalByField(
  code: string | null,
  message: string,
  values: ILimitFormValues,
  isPublic: boolean,
): IPlacedRefusal[] {
  const placed = placeRefusal(code, message, values, isPublic);
  if (!placed) return [];
  if (placed.code !== AgentLimitRefusalCodes.PublicAgentNeedsLimits) return [placed];
  return [
    { code: placed.code, place: 'limits', text: placed.text },
    { code: placed.code, place: 'public', text: placed.text },
  ];
}

/**
 * What a limit field holds in the page draft: `null` for an empty field, the
 * number for digits — in range or not, the save refuses it by its field — and
 * `NaN` for anything else, which the draft counts as a change it cannot send.
 */
export function limitTextToNumber(text: string): number | null {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  return DIGITS.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** The draft's three numbers as the text `findLimitProblem` reads. */
export function limitNumbersToForm(limits: IAgentLimits): ILimitFormValues {
  const text = (value: number | null) => (value === null ? '' : String(value));
  return {
    minute: text(limits.perMinute),
    hour: text(limits.perHour),
    day: text(limits.perDay),
  };
}

/**
 * How long until a full window has room again: `42 s`, `12 min 5 s`,
 * `2 h 5 min`. Never empty and never negative.
 */
export function formatRoomIn(seconds: number): string {
  const total = Math.max(1, Math.ceil(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    const rest = total % 60;
    return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
