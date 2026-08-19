/**
 * Single source of truth for the locales the app console ships.
 *
 * Every slice registers this list (`i18n: { langDir: 'locales', locales: LOCALES }`)
 * instead of repeating the entries, so adding a language is a one-line change
 * here rather than one edit per slice — and slices can't drift apart.
 *
 * Adding a locale means every slice that registers this list also needs the
 * matching file on disk: a declared locale with no `<code>.json` breaks the
 * build. `bun run i18n:sync` creates and fills them; `bun run i18n:check`
 * fails CI when one falls behind `en.json`.
 *
 * admin/ is deliberately not localized — see
 * docs/superpowers/specs/2026-08-19-i18n-strategy-design.md.
 */
// `as const` on the codes keeps them literal ('en' | 'ru') instead of widening
// to string: @nuxtjs/i18n types the locale list by the literal codes it knows,
// and a plain string[] here fails to typecheck in every slice config.
export const LOCALES = [
  { code: 'en' as const, file: 'en.json' },
  { code: 'ru' as const, file: 'ru.json' },
];

/** The locale translations are written in; every other locale is derived from it. */
export const SOURCE_LOCALE = 'en';
