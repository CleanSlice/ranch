import {
  ALLOWED_MIME_TYPES,
  IMAGE_MIME_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  TEXT_MIME_TYPES,
} from '#/bridle/domain/attachment.constants';
import {
  IAgentLimits,
  hasAnyLimit,
} from '#/agent/limit/domain/agentLimit.types';
import {
  IShareAttachments,
  IShareLimits,
  IShareSkill,
  SHARE_DESCRIPTION_MAX,
  ShareAttachmentKind,
} from './shareLink.types';

// What a share visitor is told about the agent (CLEAN-237). Pure functions,
// one per section of the visitor's info panel, and each one names the fields
// it lets through: nothing here spreads a record, so a column added to an
// agent, a skill or a limit later does not reach a visitor by accident.

/**
 * The agent's own description, else its template's, else nothing. Unlike the
 * A2A card there is no made-up last resort: a visitor is better served by no
 * description than by a sentence that only repeats the name.
 */
export function describeForVisitor(
  config: unknown,
  templateDescription: string | null | undefined,
): string | null {
  const own =
    config && typeof config === 'object'
      ? (config as Record<string, unknown>).description
      : undefined;
  const text =
    (typeof own === 'string' && own.trim()) ||
    (typeof templateDescription === 'string' && templateDescription.trim()) ||
    '';
  return text ? text.slice(0, SHARE_DESCRIPTION_MAX) : null;
}

/** A skill without a title has nothing to show and is dropped. */
export function skillsForVisitor(
  skills: { title: string; description: string | null }[],
): IShareSkill[] {
  return skills
    .map((skill) => ({
      title: typeof skill.title === 'string' ? skill.title.trim() : '',
      description:
        (typeof skill.description === 'string' && skill.description.trim()) ||
        null,
    }))
    .filter((skill) => skill.title.length > 0);
}

/** The configured values, or null when no window is limited. */
export function limitsForVisitor(
  limits: IAgentLimits | null,
): IShareLimits | null {
  if (!limits || !hasAnyLimit(limits)) return null;
  return {
    perMinute: limits.perMinute,
    perHour: limits.perHour,
    perDay: limits.perDay,
  };
}

const KIND_BY_MIME: Record<string, ShareAttachmentKind> = {
  'application/pdf': 'pdf',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'document',
  'application/vnd.ms-excel': 'spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    'spreadsheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12': 'spreadsheet',
  'application/vnd.ms-powerpoint': 'presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'presentation',
};

/** The order a visitor reads them in. */
const KIND_ORDER: ShareAttachmentKind[] = [
  'image',
  'pdf',
  'document',
  'spreadsheet',
  'presentation',
  'text',
];

/** The family an accepted MIME type is shown under; null for one that has
 *  none yet. */
export function kindOf(mime: string): ShareAttachmentKind | null {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return 'image';
  if ((TEXT_MIME_TYPES as readonly string[]).includes(mime)) return 'text';
  return KIND_BY_MIME[mime] ?? null;
}

/** The same limits the upload route enforces, read from the same constants. */
export function attachmentsForVisitor(): IShareAttachments {
  const accepted = new Set(ALLOWED_MIME_TYPES.map(kindOf));
  return {
    maxPerMessage: MAX_ATTACHMENTS_PER_MESSAGE,
    maxFileBytes: MAX_ATTACHMENT_BYTES,
    maxMessageBytes: MAX_MESSAGE_ATTACHMENT_BYTES,
    kinds: KIND_ORDER.filter((kind) => accepted.has(kind)),
  };
}
