import { SOURCE_LOCALE } from '../locales';

export default defineI18nConfig(() => ({
  legacy: false,
  locale: SOURCE_LOCALE,
  // A key that hasn't been translated yet renders its English text instead of
  // the raw key path — so a slice mid-extraction degrades to English rather
  // than showing `chat.send` to the user.
  fallbackLocale: SOURCE_LOCALE,
  // No `messages` here on purpose: every slice ships its own locale files and
  // the module merges them. Listing locales again would mean editing this file
  // too whenever LOCALES changes.
}));
