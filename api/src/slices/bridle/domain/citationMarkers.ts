/**
 * `[^n]` citation markers (CLEAN-138) in text that reaches a reader with no
 * list to point at: the synchronous HTTP reply, and anything else that is
 * not a Bridle client advertising the `sources` capability. The runtime
 * already strips them for such callers; this is the hub's own line of
 * defence, so a reader never sees the raw form.
 *
 * Markers inside fenced or inline code are left alone — there they are
 * content, not citations.
 */
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/;

export function stripCitationMarkers(text: string): string {
  if (!text || !text.includes('[^')) return text;
  return text
    .split(CODE)
    .map((segment, i) =>
      i % 2 === 1 ? segment : segment.replace(/ ?\[\^\d{1,3}\]/g, ''),
    )
    .join('');
}
