# Contract: the locale check

A command that reads the source of both consoles and fails when a value's
language could come from the wrong place. No network, no API key, no build: it
runs in seconds, locally and in CI.

```bash
bun run locale:check
```

It sits next to `bun run i18n:check`, which keeps verifying translation parity
in `app`. The two answer different questions and neither replaces the other:

| | asks |
|---|---|
| `i18n:check` | does every key exist in every language? |
| `locale:check` | does every value take its language from the console's rule? |

## Exit

| Code | Meaning |
|------|---------|
| `0` | no findings |
| `1` | one or more findings; all of them are printed |
| `2` | the check itself could not run (a directory is missing, a file cannot be read) |

A check that cannot run is a failure, never a pass.

## Output

One line per finding, then a summary:

```text
admin/slices/chat/utils/transcript.ts:100  L1  toLocaleTimeString(
  language-sensitive call outside the format module — use formatMessageTime from #common/utils/format

locale: 1 finding in 1 file (L1: 1). <n> files checked.
```

On a pass:

```text
locale: <n> files checked, no findings.
```

The number of files checked is always printed. A pass over zero files is how a
wrong path looks, and it must not look like success.

## Scope

| Included | Excluded |
|----------|----------|
| `admin/slices/**/*.{vue,ts}` | `*.test.ts`, `*.spec.ts` |
| `app/slices/**/*.{vue,ts}` | the generated SDK (`**/repositories/api/**`) |
| `api/src/**/*.tool.ts` (rule L4 only) | `node_modules`, `.nuxt`, `.output` |
| the admin i18n setup and locale files (rule L3) | each console's format module (rule L1 only) |

## Rules

### L1 — language-sensitive formatting lives in the format module

Both consoles. A finding is any of these outside the console's format module:

`toLocaleString(` · `toLocaleDateString(` · `toLocaleTimeString(` ·
`localeCompare(` · `Intl.DateTimeFormat` · `Intl.NumberFormat` ·
`Intl.RelativeTimeFormat` · `Intl.PluralRules` · `Intl.ListFormat` ·
`Intl.Collator` · `Intl.DisplayNames` · `useTimeAgo(` · `useTimeAgoIntl(` · `useDateFormat(` ·
`navigator.language` · `navigator.languages`

The rule looks at *where* a call sits, not at its arguments. That is deliberate:
"is this locale argument the right one" needs understanding; "is this call in
the one file allowed to make it" is a lookup.

### L2 — admin source is written in Latin script

Admin only. A finding is any letter whose script is neither Latin nor Common in
an admin source file. Punctuation and symbols (`—`, `…`, `«»`, `·`, `⚠`) are not
letters and pass.

This catches Russian, Ukrainian, Greek, Arabic, CJK. It does **not** catch
German or Spanish written in Latin letters — telling English from another
Latin-script language is a judgment, not a rule, and review owns it. The
limitation is stated in `docs/i18n.md` rather than hidden.

### L3 — admin has one language and does not ask the browser

Admin only. Findings:

- a locale file under `admin/slices/**/i18n/locales/` other than `en.json`;
- `detectBrowserLanguage` anywhere in an admin `nuxt.config.ts`;
- a `defaultLocale` or `locale` in the admin i18n setup other than `en`.

### L4 — agent tool metadata is written in Latin script

`api/src/**/*.tool.ts`. A finding is a letter whose script is neither Latin nor
Common inside the `title`, `template` or `description` of a tool. These three
are what the admin tool catalog shows an operator.

### L5 — app interface text goes through translation

App only, `.vue` files. Findings:

- a text node in the template that contains a letter and is not inside an
  interpolation;
- a static `placeholder`, `title`, `aria-label`, `alt` or `label` attribute
  whose value contains a letter.

Templates are read as a syntax tree, not matched as text, so a `>` inside an
expression or a multi-line attribute does not confuse the rule.

What L5 cannot see — a raw value rendered through an interpolation, a sentence
chosen in script — is listed in [app-format.md](app-format.md) together with
what covers it instead.

## Exceptions

An exception is a line in the check's own allowlist, with the file, the rule and
the reason. There is no inline "ignore next line" comment: an exception that
lives next to the code it excuses gets copied along with the code.

The allowlist holds the format modules (for L1) — `utils/format.ts` in each
console, plus admin's `composables/useRelativeTime.ts`, kept apart so the module
itself stays free of Vue — and the two key caps in the chat input (for L5). An
entry may name the exact text it excuses, so that excusing `Enter` does not
excuse the rest of the file. A
pull request that adds to it says why in its description.

An allowlist entry that no longer matches anything is itself a finding, so the
list cannot outlive the code it excuses.

## Where it runs

| Place | When |
|-------|------|
| `ci.yaml` | every pull request and every push to `main`, next to `i18n:check` |
| `build-images.yaml` | before the `admin` and `app` images are built, so a finding stops the image |
| locally | `bun run locale:check` |

## Proving the check works

The check has its own tests, fed with small fixture sources rather than the real
tree, one passing and one failing sample per rule. The check is trusted because
each rule has been seen to fail, not because the tree is currently clean.
