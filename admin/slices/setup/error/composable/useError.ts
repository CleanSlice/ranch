// composables/useAppError.ts
import { ref } from "vue";
import { ErrorEntity } from "../domain/error.entity";

const error = ref<ErrorEntity | null>(null);

export function useAppError() {
  const show = (err: ErrorEntity) => {
    error.value = err; //reactive for watch in component
  };

  const clear = () => {
    error.value = null;
  };

  return { error, show, clear };
}
