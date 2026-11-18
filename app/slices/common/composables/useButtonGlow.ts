/**
 * The light in a primary or accent pill follows the pointer.
 *
 * One delegated pointermove listener on the landing root writes two custom
 * properties on the pill under the cursor: `--hx`, the pointer's x inside the
 * pill, where landing.css puts the hot spot, and `--gx`, the offset from the
 * pill's centre (halved and clamped), which leans the light that falls under
 * it. The pill's own transitions do the easing. Nothing loops and nothing is
 * drawn by script.
 *
 * Off under reduced motion and on devices without hover: both stay unset, so
 * the spot rests near the arrow and the light under the pill sits centred.
 * Throttled to animation frames.
 */
const SELECTOR = '.land-btn--primary, .land-btn--accent';

export function useButtonGlow() {
  let root: HTMLElement | null = null;
  let current: HTMLElement | null = null;
  let frame = 0;
  let x = 0;

  function paint() {
    frame = 0;
    if (!current) return;
    const r = current.getBoundingClientRect();
    const limit = r.width * 0.32;
    const offset = Math.max(-limit, Math.min(limit, (x - (r.left + r.width / 2)) * 0.5));
    const inside = Math.max(r.width * 0.1, Math.min(r.width * 0.9, x - r.left));
    current.style.setProperty('--gx', `${offset.toFixed(1)}px`);
    current.style.setProperty('--hx', `${inside.toFixed(1)}px`);
  }

  function release() {
    current?.style.removeProperty('--gx');
    current?.style.removeProperty('--hx');
    current = null;
  }

  function onMove(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const pill = (e.target as Element | null)?.closest?.<HTMLElement>(SELECTOR) ?? null;
    if (pill !== current) release();
    if (!pill) return;
    current = pill;
    x = e.clientX;
    if (!frame) frame = requestAnimationFrame(paint);
  }

  onMounted(() => {
    root = document.querySelector<HTMLElement>('.landing');
    root?.addEventListener('pointermove', onMove, { passive: true });
    root?.addEventListener('pointerleave', release);
  });

  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame);
    root?.removeEventListener('pointermove', onMove);
    root?.removeEventListener('pointerleave', release);
    release();
  });
}
