<script setup lang="ts">
/**
 * The back of the pass: the account as the console holds it (CLEAN-217).
 * A row exists only when its value does; nothing is padded with a dash.
 */
const props = defineProps<{
  /** Null when the account has no name: the row is left out. */
  name: string | null;
  email: string;
  id: string;
  roleLabel: string;
  /** Null when the build carries no version: the row is left out. */
  version: string | null;
}>();

// "Copied" stays for two seconds, long enough to read and to be announced by
// the polite live region, short enough not to linger after the next click.
const COPIED_MS = 2000;
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

async function copyId() {
  try {
    await navigator.clipboard.writeText(props.id);
  } catch {
    // No clipboard (insecure origin, permission denied): say nothing rather
    // than claim a copy that did not happen. The id is selectable text.
    return;
  }
  copied.value = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    copied.value = false;
  }, COPIED_MS);
}
onUnmounted(() => {
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <section class="profile-card" :aria-labelledby="'profile-account-title'">
    <div class="flex items-baseline justify-between gap-3 pb-2 pt-4">
      <h2 id="profile-account-title" class="m-0 text-base font-semibold">
        {{ $t('profile.account') }}
      </h2>
      <span class="profile-card__caption">{{ $t('profile.back') }}</span>
    </div>

    <dl class="m-0">
      <div v-if="name" class="profile-card__row">
        <dt>{{ $t('profile.name') }}</dt>
        <dd data-account-name>{{ name }}</dd>
      </div>
      <div class="profile-card__row">
        <dt>{{ $t('profile.email') }}</dt>
        <dd data-account-email>{{ email }}</dd>
      </div>
      <div class="profile-card__row">
        <dt>{{ $t('profile.id') }}</dt>
        <dd class="flex min-w-0 items-center gap-1.5">
          <span
            v-if="copied"
            class="shrink-0 text-[11.5px] text-emerald-400"
            aria-hidden="true"
          >
            {{ $t('profile.copied') }}
          </span>
          <span class="text-right [overflow-wrap:anywhere]" data-account-id>{{ id }}</span>
          <button
            type="button"
            class="grid h-11 w-11 flex-none place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            :aria-label="$t('profile.copy_id')"
            data-copy-id
            @click="copyId"
          >
            <Icon :name="copied ? 'check' : 'copy'" :size="16" />
          </button>
        </dd>
      </div>
      <div class="profile-card__row">
        <dt>{{ $t('profile.role') }}</dt>
        <dd data-account-role>{{ roleLabel }}</dd>
      </div>
      <div v-if="version" class="profile-card__row">
        <dt>{{ $t('profile.version') }}</dt>
        <dd class="text-muted-foreground" data-account-version>{{ version }}</dd>
      </div>
    </dl>

    <!-- Announced, not seen: the visible "Copied" sits by the id. -->
    <span class="sr-only" aria-live="polite" data-copied>
      {{ copied ? $t('profile.copied') : '' }}
    </span>
  </section>
</template>

<style scoped>
.profile-card {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 18px;
  background: rgba(22, 17, 28, 0.72);
  padding: 8px 26px 12px;
}
.profile-card__caption {
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}
.profile-card__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 46px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.profile-card__row dt {
  flex: none;
  color: var(--muted-foreground);
}
.profile-card__row dd {
  margin: 0;
  min-width: 0;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 13px;
  text-align: right;
  overflow-wrap: anywhere;
}
@media (max-width: 479px) {
  .profile-card {
    padding-inline: 18px;
  }
}
</style>
