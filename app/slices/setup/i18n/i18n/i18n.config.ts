import { SOURCE_LOCALE } from '../locales';
import { russianPlural } from '../plural';

export default defineI18nConfig(() => ({
  legacy: false,
  locale: SOURCE_LOCALE,
  // A key that hasn't been translated yet renders its English text instead of
  // the raw key path — so a slice mid-extraction degrades to English rather
  // than showing `chat.send` to the user.
  fallbackLocale: SOURCE_LOCALE,
  pluralRules: {
    /**
     * Russian needs three plural forms where English has two — "1 слот",
     * "2 слота", "5 слотов" — so vue-i18n's default (English) rule would pick
     * the wrong branch for most numbers. The rule and its tests are in
     * `../plural.ts`.
     */
    ru: russianPlural,
  },
  // No `messages` here on purpose: every slice ships its own locale files and
  // the module merges them. Listing locales again would mean editing this file
  // too whenever LOCALES changes.
}));
