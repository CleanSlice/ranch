import { SOURCE_LOCALE } from '../locales';

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
     * the wrong branch for most numbers. Message order: zero | one | few | many.
     */
    ru: (choice: number, choicesLength: number): number => {
      if (choice === 0) return 0;
      const teen = choice > 10 && choice < 20;
      const lastDigit = choice % 10;
      if (!teen && lastDigit === 1) return 1;
      if (!teen && lastDigit >= 2 && lastDigit <= 4) return 2;
      return choicesLength < 4 ? 2 : 3;
    },
  },
  // No `messages` here on purpose: every slice ships its own locale files and
  // the module merges them. Listing locales again would mean editing this file
  // too whenever LOCALES changes.
}));
