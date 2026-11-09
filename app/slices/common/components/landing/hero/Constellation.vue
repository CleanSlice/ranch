<template>
  <!-- The agent constellation: a few intelligent nodes, thin routes, one RANCH
       hub. Decorative overlay on the horizon; simplified on phones. -->
  <svg
    class="land-const"
    viewBox="0 0 1440 640"
    preserveAspectRatio="xMidYMid slice"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="land-const-route" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#C9A1E4" stop-opacity="0" />
        <stop offset="0.5" stop-color="#C9A1E4" stop-opacity="0.45" />
        <stop offset="1" stop-color="#F5A16B" stop-opacity="0" />
      </linearGradient>
      <radialGradient id="land-const-halo" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#F5A16B" stop-opacity="0.9" />
        <stop offset="1" stop-color="#F5A16B" stop-opacity="0" />
      </radialGradient>
    </defs>

    <g class="land-const__drift">
      <!-- Orbital routes -->
      <g fill="none" stroke="url(#land-const-route)" stroke-width="1">
        <path d="M120 420 C 400 290, 740 250, 1040 300 S 1360 400, 1420 470" />
        <path class="land-const__wide" d="M220 540 C 480 430, 780 380, 1180 410" />
      </g>
      <!-- Hub links -->
      <g fill="none" stroke="rgba(201,161,228,0.35)" stroke-width="1" stroke-dasharray="4 8" class="land-const__links">
        <path d="M720 330 L 440 400" />
        <path d="M720 330 L 1010 372" />
        <path class="land-const__wide" d="M720 330 L 720 160" />
        <path class="land-const__wide" d="M440 400 L 250 470" />
      </g>

      <!-- Light pulses travelling the routes -->
      <g class="land-const__pulse" style="--t: 16s">
        <circle r="7" fill="#F5A16B" opacity="0.25" />
        <circle r="2.4" fill="#FBE9E3" />
      </g>
      <g class="land-const__pulse land-const__pulse--b land-const__wide" style="--t: 21s; animation-delay: -9s">
        <circle r="6" fill="#C9A1E4" opacity="0.25" />
        <circle r="2" fill="#F8F5FA" />
      </g>

      <!-- Hub -->
      <circle cx="720" cy="330" r="34" fill="url(#land-const-halo)" opacity="0.35" />
      <circle cx="720" cy="330" r="16" fill="none" stroke="rgba(245,161,107,0.4)" stroke-width="1" class="land-const__ring" />
      <circle cx="720" cy="330" r="4.5" fill="#F5A16B" class="land-const__node" style="--d: 0s" />

      <!-- Agents -->
      <circle cx="440" cy="400" r="3" fill="#F5A16B" class="land-const__node" style="--d: 2.2s" />
      <circle cx="1010" cy="372" r="3" fill="#F5A16B" class="land-const__node" style="--d: 4.1s" />
      <circle cx="250" cy="470" r="2.2" fill="#C9A1E4" class="land-const__node land-const__wide" style="--d: 1.3s" />
      <circle cx="720" cy="160" r="2.2" fill="#C9A1E4" class="land-const__node land-const__wide" style="--d: 3.4s" />
      <circle cx="1180" cy="410" r="2.2" fill="#C9A1E4" class="land-const__node land-const__wide" style="--d: 5.6s" />
      <circle cx="1040" cy="300" r="1.8" fill="#F8F5FA" class="land-const__node land-const__wide" style="--d: 6.5s" />
      <circle cx="120" cy="420" r="1.8" fill="#F8F5FA" class="land-const__node land-const__wide" style="--d: 7.7s" />
    </g>
  </svg>
</template>

<style scoped>
.land-const {
  position: absolute;
  left: 0;
  right: 0;
  top: 38%;
  width: 100%;
  height: 46%;
  pointer-events: none;
  overflow: visible;
}
.land-const__drift {
  animation: land-drift 22s ease-in-out infinite;
  transform-origin: 50% 50%;
}
.land-const__node {
  animation: land-node-breathe 6s ease-in-out infinite;
  animation-delay: var(--d, 0s);
}
.land-const__ring {
  transform-origin: 720px 330px;
  transform-box: view-box;
  animation: land-pulse-ring 5s ease-out infinite;
}
.land-const__links {
  animation: land-dash 14s linear infinite;
}
/* Pulses ride the two orbital routes end to end, fading at both ends. */
.land-const__pulse {
  offset-path: path('M120 420 C 400 290, 740 250, 1040 300 S 1360 400, 1420 470');
  offset-rotate: 0deg;
  animation: land-travel var(--t, 16s) linear infinite;
}
.land-const__pulse--b {
  offset-path: path('M220 540 C 480 430, 780 380, 1180 410');
}
@keyframes land-travel {
  0% {
    offset-distance: 0%;
    opacity: 0;
  }
  12% {
    opacity: 1;
  }
  88% {
    opacity: 1;
  }
  100% {
    offset-distance: 100%;
    opacity: 0;
  }
}
@media (max-width: 767px) {
  .land-const {
    top: 30%;
    height: 40%;
  }
  .land-const__wide {
    display: none;
  }
}
</style>
