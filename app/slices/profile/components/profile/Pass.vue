<script setup lang="ts">
/**
 * The pass: a badge on a lanyard that says who is signed in (CLEAN-217).
 * Identity on the face, and whatever the page puts into the `stub` slot
 * below the perforation (the installation fleet).
 */
const props = defineProps<{
  name: string;
  initials: string;
  /** Already worded: a translated role, or the raw value for an unknown one. */
  roleLabel: string;
  /** Empty when the id has nothing printable; the block is then left out. */
  registry: string;
  /** Account status as the server sent it. */
  status: string;
}>();

// A colour never goes without its word; a status we have no wording for is
// shown as received, in a neutral tone.
const STATUS: Record<string, { key: string; dot: string; text: string }> = {
  active: { key: 'profile.status_active', dot: '#2fa66b', text: '#4cc38a' },
  invited: { key: 'profile.status_invited', dot: '#f59e0b', text: '#fbbf24' },
  disabled: { key: 'profile.status_disabled', dot: '#f43f5e', text: '#fb7185' },
};
const statusMeta = computed(() => STATUS[props.status.toLowerCase()] ?? null);

/* ── Tilt ─────────────────────────────────────────────────────────────────
   The card leans up to 6 degrees after a fine pointer and the foil moves
   with it. Only `transform`, only on devices that hover, never under reduced
   motion: on those the listener is not even attached and the card carries no
   transform at all. Nothing here loops. */
const MAX_TILT = 6;
const card = ref<HTMLElement | null>(null);
const tilting = ref(false);
let frame = 0;

function onMove(event: PointerEvent) {
  const el = card.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    el.style.setProperty('--rx', `${(-y * 2 * MAX_TILT).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(x * 2 * MAX_TILT).toFixed(2)}deg`);
    el.style.setProperty('--fx', `${(x * 36).toFixed(1)}px`);
    el.style.setProperty('--fy', `${(y * 36).toFixed(1)}px`);
  });
}
function onLeave() {
  const el = card.value;
  if (!el) return;
  cancelAnimationFrame(frame);
  for (const name of ['--rx', '--ry', '--fx', '--fy']) el.style.removeProperty(name);
}

// The drop, the swing and the pointer nudge live in their own composable;
// this component keeps the tilt.
const root = ref<HTMLElement | null>(null);
const rig = ref<HTMLElement | null>(null);
const hanger = ref<HTMLElement | null>(null);
usePassSwing({ root, rig, hanger });

onMounted(() => {
  const el = card.value;
  if (!el) return;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || reduced) return;
  tilting.value = true;
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', onLeave);
});
onUnmounted(() => {
  cancelAnimationFrame(frame);
  card.value?.removeEventListener('pointermove', onMove);
  card.value?.removeEventListener('pointerleave', onLeave);
});
</script>

<template>
  <!-- -mt-6 cancels the layout's top padding: the lanyard starts at the
       header's lower edge, where it is pinned. -->
  <section
    ref="root"
    class="profile-pass mx-auto -mt-6 w-full max-w-[400px]"
    :aria-label="$t('profile.pass_label', { name })"
  >
    <!-- The rig turns around the top of the lanyard; the hanger (clip and
         card) turns around the clip. -->
    <div ref="rig" class="profile-pass__rig flex flex-col items-center" data-profile-rig>
    <div class="profile-pass__lanyard" aria-hidden="true" />
    <div ref="hanger" class="profile-pass__hanger flex w-full flex-col items-center">
    <div class="profile-pass__clip" aria-hidden="true" />

    <div
      ref="card"
      class="profile-pass__card relative w-full overflow-hidden rounded-[24px]"
      :class="tilting && 'profile-pass__card--tilt'"
      data-profile-pass
    >
      <!-- Foil: top right, clear of every line of text below it. -->
      <div class="profile-pass__foil" aria-hidden="true" />
      <div class="profile-pass__slot" aria-hidden="true" />

      <div class="relative flex flex-col gap-[22px] px-[30px] pb-[26px] pt-[52px]">
        <div class="flex items-center justify-between gap-3">
          <LandingBrandLogo variant="full" :size="26" />
          <span class="profile-pass__caption">{{ $t('profile.pass') }}</span>
        </div>

        <div class="flex flex-col items-center gap-3.5 pt-1.5">
          <ProfileSign
            :initials="initials"
            :size="176"
            :label="$t('profile.sign_label', { name })"
            data-profile-sign
          />
          <h1
            class="m-0 text-center text-[32px] font-semibold leading-[1.1] tracking-[-0.01em] [overflow-wrap:anywhere]"
            data-profile-name
          >
            {{ name }}
          </h1>
          <p class="profile-pass__role m-0 text-center uppercase" data-profile-role>
            {{ roleLabel }}
          </p>
        </div>

        <div class="grid grid-cols-2 gap-4 pt-1">
          <div v-if="registry" class="flex flex-col gap-[5px]">
            <span class="profile-pass__caption">{{ $t('profile.registry') }}</span>
            <span class="profile-pass__registry" data-profile-registry>{{ registry }}</span>
          </div>
          <div
            v-if="status"
            class="col-start-2 flex flex-col items-end gap-[5px]"
            data-profile-status
          >
            <span class="profile-pass__caption">{{ $t('profile.account') }}</span>
            <span
              class="flex items-center gap-[7px] font-mono text-[13px]"
              :style="{ color: statusMeta?.text ?? 'var(--muted-foreground)' }"
            >
              <span
                class="h-2 w-2 rounded-full"
                :style="{ background: statusMeta?.dot ?? 'var(--muted-foreground)' }"
                aria-hidden="true"
              />
              {{ statusMeta ? $t(statusMeta.key) : status }}
            </span>
          </div>
        </div>
      </div>

      <template v-if="$slots.stub">
        <div class="profile-pass__perforation" aria-hidden="true">
          <span class="profile-pass__notch profile-pass__notch--left" />
          <span class="profile-pass__notch profile-pass__notch--right" />
          <span class="profile-pass__dash" />
        </div>
        <div class="relative px-[30px] pb-7 pt-[18px]">
          <slot name="stub" />
        </div>
      </template>
    </div>
    </div>
    </div>
  </section>
</template>

<style scoped>
/* Colours are the mock-up's (profile-a-propusk.html): plum card, lavender
   structure, copper for the role line only. */
/* Whatever rises above the section's top edge is behind the header: the
   header is translucent, so the pass is cut there instead of showing through
   it while it drops. Sides and bottom stay open for the swing and the shadow. */
.profile-pass {
  clip-path: inset(0 -260px -260px -260px);
}
.profile-pass__rig {
  transform-origin: 50% 0;
}
.profile-pass__hanger {
  transform-origin: 50% 0;
}
/* The lanyard carries on above the header edge, so the 16 px it gives when
   it catches the pass never opens a gap at the top. */
.profile-pass__lanyard::before {
  content: '';
  position: absolute;
  left: -1px;
  right: -1px;
  bottom: 100%;
  height: 80px;
  background: inherit;
  border-inline: inherit;
}
.profile-pass__lanyard {
  position: relative;
  /* 62 px of lanyard as on the mock-up, plus the 24 px of layout padding it
     now crosses to reach the header. */
  height: 86px;
  width: 30px;
  background: repeating-linear-gradient(180deg, #2a2033 0, #2a2033 7px, #332740 7px, #332740 8px);
  border-inline: 1px solid rgba(201, 161, 228, 0.35);
}
.profile-pass__clip {
  position: relative;
  z-index: 2;
  width: 46px;
  height: 20px;
  margin-bottom: -12px;
  border-radius: 6px;
  background: linear-gradient(180deg, #5a4a66, #2c2236);
  border: 1px solid rgba(255, 255, 255, 0.22);
}
.profile-pass__card {
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: linear-gradient(158deg, #211829 0%, #140f1b 52%, #1c1322 100%);
  box-shadow:
    0 40px 80px -30px rgba(0, 0, 0, 0.9),
    0 0 0 1px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
/* Only a card that may tilt carries a transform; a flat one has none, which
   is what reduced motion and touch devices get. */
.profile-pass__card--tilt {
  transform: perspective(900px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
  transition: transform 220ms ease-out;
}
.profile-pass__foil {
  position: absolute;
  top: -150px;
  right: -150px;
  width: 340px;
  height: 340px;
  border-radius: 50%;
  background: conic-gradient(
    from 210deg,
    rgba(245, 161, 107, 0) 0deg,
    rgba(245, 161, 107, 0.34) 50deg,
    rgba(201, 161, 228, 0.36) 110deg,
    rgba(245, 161, 107, 0.16) 170deg,
    rgba(201, 161, 228, 0) 230deg,
    rgba(245, 161, 107, 0) 360deg
  );
  filter: blur(26px);
  transform: translate(var(--fx, 0px), var(--fy, 0px));
  transition: transform 220ms ease-out;
}
.profile-pass__slot {
  position: absolute;
  top: 16px;
  left: 50%;
  width: 62px;
  height: 12px;
  margin-left: -31px;
  border-radius: 999px;
  background: var(--background);
  box-shadow:
    inset 0 1px 3px rgba(0, 0, 0, 0.9),
    0 1px 0 rgba(255, 255, 255, 0.08);
}
.profile-pass__caption {
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}
.profile-pass__role {
  font-family: DotGothic16, 'Geist Mono', monospace;
  font-size: 15px;
  letter-spacing: 0.16em;
  color: var(--primary);
}
.profile-pass__registry {
  font-family: DotGothic16, 'Geist Mono', monospace;
  font-size: 20px;
  letter-spacing: 0.08em;
}
.profile-pass__perforation {
  position: relative;
  height: 22px;
}
.profile-pass__notch {
  position: absolute;
  top: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--background);
  border: 1px solid rgba(255, 255, 255, 0.14);
}
.profile-pass__notch--left {
  left: -12px;
}
.profile-pass__notch--right {
  right: -12px;
}
.profile-pass__dash {
  position: absolute;
  left: 22px;
  right: 22px;
  top: 10px;
  border-top: 2px dashed rgba(255, 255, 255, 0.2);
}
@media (prefers-reduced-motion: reduce) {
  .profile-pass__card--tilt,
  .profile-pass__foil {
    transform: none;
    transition: none;
  }
}
</style>
