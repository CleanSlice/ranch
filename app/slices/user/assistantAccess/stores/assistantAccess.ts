import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  AssistantAccessService,
  IMyAssistantAccess,
} from '#assistantAccess/domain';

const getService = createServiceGetter<AssistantAccessService>(
  '$assistantAccessService',
);

/**
 * What the assistant offers the person signed in (CLEAN-240): one record,
 * theirs. Read when their badge is first drawn and again when another
 * account signs in; nothing is edited from this console.
 */
export const useAssistantAccessStore = defineStore('assistantAccess', () => {
  const mine = ref<IMyAssistantAccess | null>(null);
  let inFlight: Promise<void> | null = null;
  // Bumped when the account changes: an answer for the previous person must
  // not become this one's level.
  let accountGeneration = 0;

  function resetForAccount() {
    accountGeneration += 1;
    mine.value = null;
    inFlight = null;
  }

  /** Asked once per account, however many places draw the badge. */
  function ensureMine(): Promise<void> {
    if (mine.value) return Promise.resolve();
    if (!inFlight) {
      const generation = accountGeneration;
      inFlight = getService()
        .mine()
        .then((loaded) => {
          if (generation === accountGeneration) mine.value = loaded;
        })
        // A badge that cannot be read is a badge that is not there.
        .catch(() => undefined)
        .finally(() => {
          if (generation === accountGeneration) inFlight = null;
        });
    }
    return inFlight;
  }

  return { mine, resetForAccount, ensureMine };
});
