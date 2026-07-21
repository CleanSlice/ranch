import { toast } from "vue-sonner";
import { ErrorEntity } from "../domain/error.entity";

// Error titles/descriptions are i18n keys generated at runtime (e.g.
// "unexpected_error_title") — translate before showing, otherwise the raw key
// leaks into the toast. Falls back to the key itself when no translation
// exists or when called outside the Nuxt context.
const translate = (key: string): string => {
  try {
    const { $i18n } = useNuxtApp();
    return $i18n.te(key) ? $i18n.t(key) : key;
  } catch {
    return key;
  }
};

export const handleAppError = (
  error: ErrorEntity,
  showToast = true
): string => {
  if (showToast) {
    toast.error(translate(error.title), {
      description: translate(error.description),
    });
  }
  return error.description;
};
