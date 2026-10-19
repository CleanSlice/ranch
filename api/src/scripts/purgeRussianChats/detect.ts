/**
 * Deciding which chats carry Russian (CLEAN-169).
 *
 * The test is the presence of Cyrillic, not `ChatSession.insights.language`.
 * That field is written by the summarizer, which only runs on chats with at
 * least three user messages, so a two-message "привет" never gets one; and
 * the parser accepts whatever string the model returned, defaulting to 'en'.
 * A rule that decides what gets deleted has to be a rule, not a judgment.
 *
 * Cyrillic is wider than Russian — Ukrainian, Bulgarian and Serbian match
 * too. For this installation that is accepted; if it ever stops being true,
 * this is the one place to narrow.
 */

/** Basic Cyrillic. Every Russian letter lives in this block. */
const CYRILLIC = /[Ѐ-ӿ]/;
const CYRILLIC_ALL = /[Ѐ-ӿ]/g;

export interface ICyrillicScan {
  /** True when any message carries Cyrillic, whoever wrote it. */
  hit: boolean;
  /** Cyrillic characters the person typed. */
  userChars: number;
  /**
   * Cyrillic characters in everything else. The chat list preview shows the
   * last message whatever its role, so a Russian reply to an English
   * question is just as visible to the customer.
   */
  assistantChars: number;
}

export function hasCyrillic(text: string): boolean {
  return CYRILLIC.test(text);
}

/**
 * Counts rather than just flags: the counts are what a human reads in the
 * dry run to spot the borderline case — one Russian word in an otherwise
 * English conversation — before anything is deleted.
 */
export function scanTranscript(
  messages: { role: string; text: string }[],
): ICyrillicScan {
  let userChars = 0;
  let assistantChars = 0;

  for (const message of messages) {
    const found = message.text.match(CYRILLIC_ALL)?.length ?? 0;
    if (found === 0) continue;
    if (message.role === 'user') userChars += found;
    else assistantChars += found;
  }

  return { hit: userChars + assistantChars > 0, userChars, assistantChars };
}
