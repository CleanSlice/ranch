import type { Ref } from 'vue';
import type { FxTokens } from './useFxTokens';

/**
 * One lamp over a whole grid of cards. A single pointermove listener on the
 * grid writes the pointer position, relative to each card, into that card's
 * `--mx` / `--my`; the cards' ::before (border light) and ::after (inner
 * glow) are radial gradients at that point with a radius wider than a card,
 * so the light spills onto the neighbours and reads as one shared source
 * rather than a highlight per card. `--spot-on` fades everything in while
 * the pointer is over the grid.
 *
 * Off under reduced motion and on devices without hover (the cards keep the
 * one-shot highlight on reveal instead). Throttled to animation frames.
 */
export function useGridSpotlight(grid: Ref<HTMLElement | null>, fx: FxTokens, selector = '[data-spot]') {
  let frame = 0;
  let last: { x: number; y: number } | null = null;

  function paint() {
    frame = 0;
    const root = grid.value;
    if (!root || !last) return;
    root.querySelectorAll<HTMLElement>(selector).forEach((card) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${last!.x - r.left}px`);
      card.style.setProperty('--my', `${last!.y - r.top}px`);
    });
  }

  function onMove(e: PointerEvent) {
    if (fx.reducedMotion || fx.noHover) return;
    last = { x: e.clientX, y: e.clientY };
    grid.value?.style.setProperty('--spot-on', '1');
    if (!frame) frame = requestAnimationFrame(paint);
  }

  function onLeave() {
    grid.value?.style.setProperty('--spot-on', '0');
  }

  onMounted(() => {
    const root = grid.value;
    if (!root) return;
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave);
  });

  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame);
    const root = grid.value;
    root?.removeEventListener('pointermove', onMove);
    root?.removeEventListener('pointerleave', onLeave);
  });
}
