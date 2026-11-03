import { useDebounceFn } from '@vueuse/core';
import type { Ref } from 'vue';
import type { SkillGroup } from '#skill/domain';

export interface SkillDraftValues {
  title: string;
  name: string;
  group: SkillGroup | null;
  description: string;
  body: string;
}

export interface SkillDraft extends SkillDraftValues {
  savedAt: string;
}

/**
 * The New skill form's local draft (CLEAN-205): what the admin typed
 * survives a closed tab. Keyed by user and slug so one admin never sees
 * another's draft on a shared browser, and so two skills being written at
 * once do not overwrite each other. Writes are debounced to half a second —
 * localStorage is synchronous and the body can be long. Removed on create.
 */
export function useSkillDraft(slug: Ref<string>) {
  const auth = useAuthStore();
  const userId = computed(() => (auth.user as { id?: string } | null)?.id ?? null);
  const key = computed(() =>
    userId.value ? `admin.skill.draft.${userId.value}.${slug.value || 'new'}` : null,
  );
  const savedAt = ref<string | null>(null);
  let lastKey: string | null = null;

  function parse(raw: string | null): Partial<SkillDraft> | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<SkillDraft>;
      return typeof parsed.body === 'string' && typeof parsed.savedAt === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * The draft for this slug, or — on a fresh New skill page, where no slug
   * is known yet — the user's newest draft whatever its slug, since the key
   * moved with the slug as the admin typed it.
   */
  function read(): SkillDraft | null {
    if (!userId.value || typeof localStorage === 'undefined') return null;
    try {
      const prefix = `admin.skill.draft.${userId.value}.`;
      let found: { key: string; draft: Partial<SkillDraft> } | null = null;
      if (key.value && slug.value) {
        const draft = parse(localStorage.getItem(key.value));
        if (draft) found = { key: key.value, draft };
      } else {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !k.startsWith(prefix)) continue;
          const draft = parse(localStorage.getItem(k));
          if (draft && (!found || (draft.savedAt ?? '') > (found.draft.savedAt ?? ''))) {
            found = { key: k, draft };
          }
        }
      }
      if (!found) return null;
      const parsed = found.draft;
      savedAt.value = parsed.savedAt ?? null;
      lastKey = found.key;
      return {
        title: parsed.title ?? '',
        name: parsed.name ?? '',
        group: parsed.group ?? null,
        description: parsed.description ?? '',
        body: parsed.body ?? '',
        savedAt: parsed.savedAt ?? '',
      };
    } catch {
      return null;
    }
  }

  // Typed before the auth store knew the user: written as soon as it does.
  let pending: SkillDraftValues | null = null;
  watch(key, (k) => {
    if (k && pending) {
      const values = pending;
      pending = null;
      void save(values);
    }
  });

  const save = useDebounceFn((values: SkillDraftValues) => {
    if (typeof localStorage === 'undefined') return;
    if (!key.value) {
      pending = values;
      return;
    }
    try {
      // The slug is part of the key: when it changes, the draft moves with it.
      if (lastKey && lastKey !== key.value) localStorage.removeItem(lastKey);
      const draft: SkillDraft = { ...values, savedAt: new Date().toISOString() };
      localStorage.setItem(key.value, JSON.stringify(draft));
      lastKey = key.value;
      savedAt.value = draft.savedAt;
    } catch {
      // Private mode or a full store: the form still works, only the draft is lost.
    }
  }, 500);

  function clear() {
    if (typeof localStorage === 'undefined') return;
    try {
      if (lastKey) localStorage.removeItem(lastKey);
      if (key.value) localStorage.removeItem(key.value);
    } catch {
      // nothing to clear
    }
    lastKey = null;
    savedAt.value = null;
  }

  return { read, save, clear, savedAt };
}
