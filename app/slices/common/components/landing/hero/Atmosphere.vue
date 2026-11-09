<template>
  <!-- Decorative only: the scene the hero sits in. Hidden from AT. -->
  <div class="land-atmo" aria-hidden="true">
    <picture class="land-atmo__picture">
      <source
        media="(max-width: 767px)"
        srcset="/landing/hero-mobile-720.webp 720w, /landing/hero-mobile-1080.webp 1080w"
        sizes="100vw"
        type="image/webp"
      />
      <img
        ref="imgEl"
        class="land-atmo__img"
        src="/landing/hero-desktop-1600.webp"
        srcset="/landing/hero-desktop-1600.webp 1600w, /landing/hero-desktop-2560.webp 2560w"
        sizes="100vw"
        alt=""
        decoding="async"
        fetchpriority="high"
        width="1600"
        height="900"
      />
    </picture>
    <!-- The same scene, alive: a 7 s loop laid over the still. It loads after
         the page has, only on wide screens, and fades in once it plays, so the
         still stays the first paint and the fallback. -->
    <video
      v-if="videoOn"
      ref="videoEl"
      class="land-atmo__video"
      :class="videoPlaying && 'land-atmo__video--on'"
      muted
      loop
      playsinline
      disablepictureinpicture
      preload="auto"
      tabindex="-1"
      @playing="videoPlaying = true"
    >
      <source src="/landing/hero-loop-1080.webm" type='video/webm; codecs="av01.0.08M.10"' />
      <source src="/landing/hero-loop-1080.mp4" type="video/mp4" />
    </video>
    <div class="land-atmo__veil" />
    <div class="land-atmo__vignette" />
    <div class="land-atmo__glow" />
    <div class="land-atmo__noise" />
    <div class="land-atmo__fade" />
  </div>
</template>

<script setup lang="ts">
/**
 * Almost-invisible parallax: the scene moves at 8% of scroll speed. Pure
 * transform, throttled to animation frames, and off under reduced motion.
 *
 * Over the still runs a short loop of the same scene (Veo 3.1 from this very
 * image, first and last frame pinned, seam cross-faded). It is a nicety, so
 * it gives way to everything else: never under reduced motion or Save-Data,
 * never on a narrow screen (the phone has its own portrait still), only
 * after the page has loaded, and paused whenever the hero is off screen.
 */
const imgEl = ref<HTMLImageElement | null>(null);
const videoEl = ref<HTMLVideoElement | null>(null);
const videoOn = ref(false);
const videoPlaying = ref(false);

let raf = 0;
let parallax = false;
let observer: IntersectionObserver | null = null;

function onScroll() {
  if (!parallax || raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const y = Math.min(window.scrollY, 1200);
    const t = `translate3d(0, ${y * 0.08}px, 0) scale(1.04)`;
    if (imgEl.value) imgEl.value.style.transform = t;
    if (videoEl.value) videoEl.value.style.transform = t;
  });
}

function wantsVideo() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (!window.matchMedia('(min-width: 768px)').matches) return false;
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (connection?.saveData) return false;
  if (connection?.effectiveType && /(^|-)2g|3g/.test(connection.effectiveType)) return false;
  return true;
}

async function startVideo() {
  videoOn.value = true;
  await nextTick();
  const video = videoEl.value;
  if (!video) return;
  // Play only while the hero is on screen; a hidden loop is wasted battery.
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) void video.play().catch(() => undefined);
      else video.pause();
    },
    { threshold: 0.05 },
  );
  observer.observe(video);
  onScroll();
}

function whenIdle(fn: () => void) {
  const run = () => {
    // Safari has no requestIdleCallback; a short timeout does the same job.
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(fn, { timeout: 2000 });
    } else {
      setTimeout(fn, 300);
    }
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
}

onMounted(() => {
  parallax = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (parallax) {
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
  if (wantsVideo()) whenIdle(() => void startVideo());
});
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll);
  if (raf) cancelAnimationFrame(raf);
  observer?.disconnect();
});
</script>

<style scoped>
.land-atmo {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background: var(--land-bg);
}
.land-atmo__picture,
.land-atmo__img,
.land-atmo__video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.land-atmo__img,
.land-atmo__video {
  object-fit: cover;
  object-position: center 62%;
  transform: scale(1.04);
  will-change: transform;
}
/* Fades in over the still once it is actually playing, so a slow network
   never shows an empty frame. */
.land-atmo__video {
  opacity: 0;
  transition: opacity 1.2s ease-out;
}
.land-atmo__video--on {
  opacity: 1;
}
/* The hero is taller than the 16:9 scene, so the image covers by height and
   the horizon would sink behind the product panel; a taller image shifted up
   keeps the sunrise line just above the panel. */
@media (min-width: 768px) {
  .land-atmo__img,
  .land-atmo__video {
    /* 126% / -26% (was 114% / -14%): on 1440×900 the lit horizon sat behind
       the Stage panel; raising the scene ~110 px keeps it in view above the
       panel. Owner's pick, variant A of FR-010 (CLEAN-215). */
    height: 126%;
    top: -26%;
  }
}
@media (max-width: 767px) {
  .land-atmo__img {
    object-position: center 70%;
  }
}
/* Darkens the top band so the headline reads on any crop. */
.land-atmo__veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(9, 7, 13, 0.6) 0%,
    rgba(9, 7, 13, 0.25) 36%,
    rgba(9, 7, 13, 0) 58%
  );
}
.land-atmo__vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(70% 55% at 50% 32%, rgba(9, 7, 13, 0) 0%, rgba(9, 7, 13, 0.5) 100%);
}
/* Horizon light that breathes over ~18 s. Positioned by the hero's horizon. */
.land-atmo__glow {
  position: absolute;
  left: 50%;
  top: 50%; /* follows the raised horizon (FR-010 variant A) */
  width: min(90vw, 1100px);
  height: 34vh;
  border-radius: 999px;
  background: radial-gradient(50% 50% at 50% 50%, rgba(245, 161, 107, 0.28) 0%, rgba(245, 161, 107, 0) 70%);
  filter: blur(40px);
  transform: translate(-50%, 0);
  animation: land-glow-breathe 18s ease-in-out infinite;
}
.land-atmo__noise {
  position: absolute;
  inset: 0;
  opacity: 0.045;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  background-size: 160px 160px;
  mix-blend-mode: overlay;
}
.land-atmo__fade {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 28%;
  background: linear-gradient(180deg, rgba(9, 7, 13, 0) 0%, rgba(9, 7, 13, 0.85) 70%, var(--land-bg) 100%);
}
</style>
