// What the person's own card works out in the browser (CLEAN-257). Pure on
// purpose: no Pinia, no Nuxt. The management console has the same function
// in its own `assistantAccess` utils; the two cards hang the same way.

/** The card beside the person's level: as wide as this, at most. */
export const BADGE_CARD_WIDTH = 288;
/** The room kept between that card and the edge of the screen. */
export const BADGE_CARD_GUTTER = 16;

/**
 * How far the card moves from the badge's left edge so that all of it is on
 * screen. The badge sits wherever the assistant's name ends; a card hung
 * from it would run off a phone. Zero while it fits; otherwise left as far
 * as needed, and never past the left gutter.
 */
export function badgeCardShift(
  left: number,
  viewport: number,
  width: number,
  gutter: number = BADGE_CARD_GUTTER,
): number {
  return Math.max(gutter - left, Math.min(0, viewport - gutter - width - left));
}
