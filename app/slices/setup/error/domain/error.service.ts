// setup/domain/service/errorHandler.ts
import { ErrorEntity } from "#error";
import { handleAppError } from "../utils/error-handle";
import { useAppError } from "../composable/useError";
import { ErrorCodes } from "./error.types";

export async function handleError(err: unknown) {
  // Geo-block (6000) / maintenance (6001): the api.config onResponse
  // interceptor already navigates to /blocked or /maintenance, and the whole
  // parallel boot wave fails with the same body — no toast, no error state,
  // no Sentry noise.
  if (
    err instanceof ErrorEntity &&
    (err.code === ErrorCodes.GEO_BLOCKED || err.code === ErrorCodes.MAINTENANCE)
  ) {
    return;
  }

  const { show, clear } = useAppError();
  const localePath = useLocalePath();
  clear();

  if (err instanceof ErrorEntity) {
    show(err);

    if (err.isToast) {
      handleAppError(err);
    }

    if (err.statusCode === 401 && err.code === ErrorCodes.UNAUTHORIZED) {
      navigateTo(localePath("/login"));
      return;
    }

    if (import.meta.dev) {
      switch (err.statusCode) {
        case 401:
          console.warn(`[DEV] Unauthorized: ${err.statusCode} ${err.message}`);
          break;
        case 403:
          console.error(`[DEV] Access Forbidden: ${err.statusCode}`, err.message);
          break;
        case 404:
          console.log(`[DEV] Resource not found: ${err.statusCode}`, err.message);
          break;
        case 500:
          console.error(`[DEV] Server Error: ${err.statusCode}`, err.message);
          break;
        default:
          console.error(`[DEV] Unhandled Status Code: ${err.statusCode}`, err.message);
      }
    }
  } else if (import.meta.dev) {
    console.error(`[DEV] No Error Entity: ${err}`);
  }

}
