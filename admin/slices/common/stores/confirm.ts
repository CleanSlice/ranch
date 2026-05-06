import { defineStore } from 'pinia';

export interface IConfirmOptions {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'default';
}

interface IConfirmRequest extends IConfirmOptions {
  resolve: (value: boolean) => void;
}

export const useConfirmStore = defineStore('confirm', () => {
  const current = ref<IConfirmRequest | null>(null);

  const open = computed({
    get: () => current.value !== null,
    set: (value: boolean) => {
      if (!value && current.value) {
        current.value.resolve(false);
        current.value = null;
      }
    },
  });

  function ask(options: IConfirmOptions = {}): Promise<boolean> {
    if (current.value) {
      current.value.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      current.value = { ...options, resolve };
    });
  }

  function accept() {
    if (!current.value) return;
    current.value.resolve(true);
    current.value = null;
  }

  return { current, open, ask, accept };
});
