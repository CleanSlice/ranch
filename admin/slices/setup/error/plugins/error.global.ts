import { handleError } from "../domain/error.service";
export default defineNuxtPlugin((nuxtApp) => {
  // Vue error handler
  nuxtApp.vueApp.config.errorHandler = (error) => {
    console.error("Vue errorHandler:", error);
    handleError(error);
  };

  // Vue error hook
  //nuxtApp.hook("vue:error", (error, instance, info) => {
  //  console.error("Vue error hook:", error);
  //});
});
