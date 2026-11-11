<template>
  <header class="land-header" :class="{ 'is-scrolled': scrolled }">
    <div class="land-header__row land-wrap">
      <!-- Brand -->
      <NuxtLink
        to="/"
        class="land-header__brand land-glass land-enter land-enter--down"
        :aria-label="$t('app_name')"
        style="--enter-dur: 650ms"
      >
        <LandingBrandLogo variant="mark" :size="32" :label="null" />
        <span class="land-header__brand-word">
          <LandingBrandLogo variant="wordmark" :size="12" :label="null" />
        </span>
      </NuxtLink>

      <!-- Desktop: section pill -->
      <nav
        class="land-header__nav land-glass land-enter land-enter--down"
        :aria-label="$t('landing_nav.sections')"
        style="--enter-dur: 650ms; --enter-delay: 40ms"
      >
        <a
          v-for="item in sections"
          :key="item.id"
          :href="`#${item.id}`"
          class="land-header__link"
          :class="{ 'is-active': activeSection === item.id }"
          @click="onSectionClick(item.id, $event)"
        >
          {{ $t(item.key) }}
        </a>
        <NuxtLink to="/agents" class="land-header__link">
          {{ $t('nav.agents') }}
        </NuxtLink>
        <NuxtLink
          v-if="authStore.isAuthenticated"
          to="/chats"
          class="land-header__link"
        >
          {{ $t('nav.history') }}
        </NuxtLink>
      </nav>

      <!-- Desktop: actions -->
      <div
        class="land-header__actions land-enter land-enter--down"
        style="--enter-dur: 650ms; --enter-delay: 80ms"
      >
        <div
          class="land-header__locale land-glass"
          role="group"
          :aria-label="$t('locale.label')"
        >
          <button
            v-for="option in locales"
            :key="option.code"
            type="button"
            class="land-header__locale-btn"
            :class="{ 'is-active': option.code === locale }"
            :aria-pressed="option.code === locale"
            @click="setLocale(option.code)"
          >
            {{ option.code.toUpperCase() }}
          </button>
        </div>

        <template v-if="authStore.isAuthenticated">
          <button
            type="button"
            class="land-header__link land-header__link--solo land-glass"
            @click="onLogout"
          >
            {{ $t('auth.sign_out') }}
          </button>
          <NuxtLink to="/agents" class="land-btn land-btn--primary land-header__cta">
            {{ $t('landing_nav.open_console') }}
          </NuxtLink>
        </template>
        <template v-else>
          <NuxtLink to="/login" class="land-header__link land-header__link--solo land-glass">
            {{ $t('auth.sign_in') }}
          </NuxtLink>
          <NuxtLink :to="startRoute" class="land-btn land-btn--primary land-header__cta">
            {{ $t('landing_nav.start') }}
          </NuxtLink>
        </template>
      </div>

      <!-- Mobile: menu button -->
      <button
        type="button"
        class="land-header__burger land-glass land-enter land-enter--down"
        :aria-expanded="menuOpen"
        aria-controls="land-mobile-menu"
        :aria-label="menuOpen ? $t('landing_nav.close_menu') : $t('landing_nav.open_menu')"
        style="--enter-dur: 650ms"
        @click="menuOpen = !menuOpen"
      >
        <Icon :name="menuOpen ? 'x' : 'menu'" :size="18" />
      </button>
    </div>

    <!-- Mobile: floating panel -->
    <Transition name="land-menu">
      <div
        v-if="menuOpen"
        id="land-mobile-menu"
        ref="menuEl"
        class="land-header__menu land-glass"
      >
        <nav :aria-label="$t('landing_nav.sections')" class="land-header__menu-nav">
          <a
            v-for="item in sections"
            :key="item.id"
            :href="`#${item.id}`"
            class="land-header__menu-link"
            @click="onSectionClick(item.id, $event)"
          >
            {{ $t(item.key) }}
          </a>
          <NuxtLink to="/agents" class="land-header__menu-link">
            {{ $t('nav.agents') }}
          </NuxtLink>
          <NuxtLink v-if="authStore.isAuthenticated" to="/chats" class="land-header__menu-link">
            {{ $t('nav.history') }}
          </NuxtLink>
        </nav>
        <div class="land-header__menu-foot">
          <div class="land-header__locale" role="group" :aria-label="$t('locale.label')">
            <button
              v-for="option in locales"
              :key="option.code"
              type="button"
              class="land-header__locale-btn"
              :class="{ 'is-active': option.code === locale }"
              :aria-pressed="option.code === locale"
              @click="setLocale(option.code)"
            >
              {{ option.code.toUpperCase() }}
            </button>
          </div>
          <template v-if="authStore.isAuthenticated">
            <button type="button" class="land-btn land-btn--ghost" @click="onLogout">
              {{ $t('auth.sign_out') }}
            </button>
            <NuxtLink to="/agents" class="land-btn land-btn--primary">
              {{ $t('landing_nav.open_console') }}
            </NuxtLink>
          </template>
          <template v-else>
            <NuxtLink to="/login" class="land-btn land-btn--ghost">
              {{ $t('auth.sign_in') }}
            </NuxtLink>
            <NuxtLink :to="startRoute" class="land-btn land-btn--primary">
              {{ $t('landing_nav.start') }}
            </NuxtLink>
          </template>
        </div>
      </div>
    </Transition>
  </header>
</template>

<script setup lang="ts">
const route = useRoute();
const authStore = useAuthStore();
const { locale, locales, setLocale } = useI18n();

/** In-page sections the pill scrolls to; the ids are set by the page. */
const sections = [
  { id: 'platform', key: 'landing_nav.platform' },
  { id: 'how', key: 'landing_nav.how' },
  { id: 'infrastructure', key: 'landing_nav.infrastructure' },
];

// "Start" goes to self-service registration only when the admin has it open;
// otherwise the honest route is sign-in (same rule as the old header).
const { enabled: registrationEnabled, refresh: refreshRegistration } =
  useRegistrationEnabled();
if (!authStore.isAuthenticated) {
  await useAsyncData('landing-registration-enabled', () => refreshRegistration());
}
const startRoute = computed(() => (registrationEnabled.value ? '/register' : '/login'));

const menuOpen = ref(false);
const menuEl = ref<HTMLElement | null>(null);
const scrolled = ref(false);
const activeSection = ref<string | null>(null);

function onSectionClick(id: string, event: MouseEvent) {
  const target = document.getElementById(id);
  if (!target) return; // not on the landing page: let the browser follow the hash
  event.preventDefault();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  history.replaceState(null, '', `#${id}`);
  menuOpen.value = false;
}

async function onLogout() {
  menuOpen.value = false;
  authStore.logout();
  await navigateTo('/');
}

// Close on navigation, Escape, and click outside.
watch(() => route.fullPath, () => (menuOpen.value = false));

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && menuOpen.value) menuOpen.value = false;
}
function onPointerDown(event: PointerEvent) {
  if (!menuOpen.value) return;
  const target = event.target as Node;
  if (menuEl.value?.contains(target)) return;
  if ((target as HTMLElement).closest?.('.land-header__burger')) return;
  menuOpen.value = false;
}
function onScroll() {
  scrolled.value = window.scrollY > 24;
}

let observer: IntersectionObserver | null = null;
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Active state for the section pill: whichever section crosses the top band.
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) activeSection.value = entry.target.id;
      }
    },
    { rootMargin: '-40% 0px -55% 0px' },
  );
  for (const { id } of sections) {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('pointerdown', onPointerDown);
  window.removeEventListener('scroll', onScroll);
  observer?.disconnect();
});
</script>

<style scoped>
.land-header {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 50;
  padding-top: 1rem;
  pointer-events: none;
}
.land-header__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  pointer-events: auto;
}
.land-header__brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  height: 3rem;
  padding: 0 0.9rem 0 0.5rem;
  border-radius: 999px;
  color: var(--land-text);
  text-decoration: none;
  transition: border-color 0.35s var(--land-ease);
}
.land-header__brand:hover {
  border-color: rgba(255, 255, 255, 0.22);
}
.land-header__brand:focus-visible,
.land-header__burger:focus-visible,
.land-header__link:focus-visible,
.land-header__locale-btn:focus-visible,
.land-header__menu-link:focus-visible {
  outline: 2px solid var(--land-orange);
  outline-offset: 2px;
}
.land-header__nav,
.land-header__actions {
  display: none;
}
.land-header__burger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  border-radius: 999px;
  color: var(--land-text);
}

/* Desktop layout from 1024px */
@media (min-width: 1024px) {
  .land-header__brand {
    height: 3.25rem;
    padding: 0 1rem 0 0.6rem;
  }
  .land-header__burger {
    display: none;
  }
  .land-header__nav {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    height: 3.25rem;
    padding: 0 0.45rem;
    border-radius: 999px;
  }
  .land-header__actions {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
}
.land-header__link {
  display: inline-flex;
  align-items: center;
  height: 2.4rem;
  padding: 0 1rem;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 500;
  color: #c9c0d0;
  text-decoration: none;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-family: inherit;
  transition:
    color 0.3s var(--land-ease),
    background-color 0.3s var(--land-ease);
}
.land-header__link:hover,
.land-header__link.router-link-active {
  color: var(--land-text);
}
.land-header__link.is-active {
  color: var(--land-text);
  background: rgba(255, 255, 255, 0.08);
}
.land-header__link--solo {
  height: 3.25rem;
  padding: 0 1.2rem;
  color: var(--land-text);
}
.land-header__cta {
  height: 3.25rem;
  font-size: 0.875rem;
}
.land-header__locale {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  height: 3.25rem;
  padding: 0 0.35rem;
  border-radius: 999px;
}
.land-header__locale-btn {
  height: 2.25rem;
  padding: 0 0.7rem;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--land-text-2);
  font-family: var(--land-mono);
  font-size: 0.75rem;
  cursor: pointer;
  transition:
    color 0.3s var(--land-ease),
    background-color 0.3s var(--land-ease);
}
.land-header__locale-btn.is-active {
  color: var(--land-text);
  background: rgba(255, 255, 255, 0.08);
}

/* Mobile panel */
.land-header__menu {
  position: absolute;
  left: 1rem;
  right: 1rem;
  top: calc(1rem + 3rem + 0.6rem);
  border-radius: 1.25rem;
  padding: 0.75rem;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  transform-origin: top right;
  /* Opaque on purpose: the hero headline sits right behind it, and a blurred
     backdrop under an animating panel leaves stale ghosts of it in Chromium. */
  background: var(--land-bg-2);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.land-header__menu-nav {
  display: flex;
  flex-direction: column;
}
.land-header__menu-link {
  display: flex;
  align-items: center;
  min-height: 3rem;
  padding: 0 1rem;
  border-radius: 0.9rem;
  font-size: 1.05rem;
  font-weight: 500;
  color: var(--land-text);
  text-decoration: none;
}
.land-header__menu-link:hover {
  background: rgba(255, 255, 255, 0.06);
}
.land-header__menu-foot {
  display: grid;
  grid-template-columns: auto 1fr 1fr;
  gap: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--land-border);
}
.land-header__menu-foot .land-header__locale {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--land-border);
  height: 3rem;
}
.land-header__menu-foot .land-btn {
  height: 3rem;
  padding: 0 1rem;
  font-size: 0.9rem;
}
@media (max-width: 420px) {
  .land-header__menu-foot {
    grid-template-columns: 1fr 1fr;
  }
  .land-header__menu-foot .land-header__locale {
    grid-column: 1 / -1;
    justify-content: center;
  }
}
@media (min-width: 1024px) {
  .land-header__menu {
    display: none;
  }
}

.land-menu-enter-active,
.land-menu-leave-active {
  transition:
    opacity 0.3s var(--land-ease),
    transform 0.35s var(--land-ease);
}
.land-menu-enter-from,
.land-menu-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
</style>
