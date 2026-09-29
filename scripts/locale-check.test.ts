import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  applyAllowlist,
  checkSource,
  exitCode,
  isChecked,
  L1_CALLS,
  render,
  run,
  type AllowEntry,
  type Finding,
} from './locale-check';

// Fixtures are small sources written here, never the real tree: a rule is
// trusted because it has been seen to fail, not because the tree is clean.

const ADMIN_FILE = 'admin/slices/chat/utils/transcript.ts';
const APP_FILE = 'app/slices/chat/utils/transcript.ts';
const ADMIN_MODULE = 'admin/slices/common/utils/format.ts';
const APP_MODULE = 'app/slices/common/utils/format.ts';

const rules = (findings: Finding[]) => findings.map((f) => f.rule);

// ------------------------------------------------------------------- scope

describe('scope', () => {
  test('console sources are checked', () => {
    expect(isChecked('admin/slices/chat/utils/transcript.ts')).toBe(true);
    expect(isChecked('app/slices/bridle/components/bridle/chat/Message.vue')).toBe(true);
  });

  test('tests and the generated SDK are not', () => {
    expect(isChecked('admin/slices/chat/utils/transcript.test.ts')).toBe(false);
    expect(isChecked('app/slices/share/domain/shareOrigin.spec.ts')).toBe(false);
    expect(
      isChecked('admin/slices/setup/api/data/repositories/api/sdk.gen.ts'),
    ).toBe(false);
    expect(isChecked('app/slices/chat/node_modules/x/index.ts')).toBe(false);
  });

  test('other file types are not', () => {
    expect(isChecked('admin/slices/common/README.md')).toBe(false);
    expect(isChecked('app/slices/common/assets/logo.svg')).toBe(false);
  });
});

// ---------------------------------------------------------------------- L1

describe('L1 — language-sensitive formatting lives in the format module', () => {
  const sample: Record<string, string> = {
    'toLocaleString(': 'const s = new Date(ts).toLocaleString();',
    'toLocaleDateString(': 'const s = d.toLocaleDateString(undefined, { month: "short" });',
    'toLocaleTimeString(': 'const s = d.toLocaleTimeString([], { hour: "2-digit" });',
    'localeCompare(': 'list.sort((a, b) => a.name.localeCompare(b.name));',
    'Intl.DateTimeFormat': 'const f = new Intl.DateTimeFormat("en", { dateStyle: "long" });',
    'Intl.NumberFormat': 'const n = new Intl.NumberFormat("en-US");',
    'Intl.RelativeTimeFormat': 'const r = new Intl.RelativeTimeFormat("en");',
    'Intl.PluralRules': 'const p = new Intl.PluralRules("ru");',
    'Intl.ListFormat': 'const l = new Intl.ListFormat("en");',
    'Intl.Collator': 'const c = new Intl.Collator("en");',
    'Intl.DisplayNames': 'const d = new Intl.DisplayNames("en", { type: "language" });',
    'useTimeAgo(': 'const ago = useTimeAgo(date);',
    'useTimeAgoIntl(': 'const ago = useTimeAgoIntl(() => date, { locale: "en" });',
    'useDateFormat(': 'const f = useDateFormat(date, "YYYY");',
    'navigator.language': 'const l = navigator.language;',
    'navigator.languages': 'const l = navigator.languages[0];',
  };

  test('the fixture covers every name the rule knows', () => {
    expect(Object.keys(sample).sort()).toEqual([...L1_CALLS].sort());
  });

  for (const [name, line] of Object.entries(sample)) {
    test(`${name} is a finding in admin and in app`, () => {
      for (const file of [ADMIN_FILE, APP_FILE]) {
        const found = checkSource(file, `// header\n${line}\n`).filter(
          (f) => f.rule === 'L1',
        );
        expect(found.length).toBe(1);
        expect(found[0]!.file).toBe(file);
        expect(found[0]!.line).toBe(2);
      }
    });
  }

  test('the language argument does not matter — only where the call sits', () => {
    const src = 'const s = d.toLocaleDateString(locale.value);\n';
    expect(rules(checkSource(APP_FILE, src))).toEqual(['L1']);
  });

  test('a finding carries the rule, the place, the text and a fix', () => {
    const src = 'const a = 1;\n  const s = d.toLocaleTimeString([], { hour: "2-digit" });\n';
    const [finding] = checkSource(ADMIN_FILE, src);
    expect(finding!.rule).toBe('L1');
    expect(finding!.file).toBe(ADMIN_FILE);
    expect(finding!.line).toBe(2);
    expect(finding!.found).toBe('const s = d.toLocaleTimeString([], { hour: "2-digit" });');
    expect(finding!.fix.includes('#common/utils/format')).toBe(true);
  });

  test('every finding is reported, not only the first', () => {
    const src = [
      'const a = d.toLocaleString();',
      'const b = n.toLocaleString(); const c = x.localeCompare(y);',
      'const e = new Intl.NumberFormat("en-US");',
    ].join('\n');
    const found = checkSource(ADMIN_FILE, src);
    expect(found.length).toBe(4);
    expect(found.map((f) => f.line)).toEqual([1, 2, 2, 3]);
  });

  test('a call inside a template expression is found', () => {
    const src = '<template>\n  <span>{{ value.toLocaleString() }}</span>\n</template>\n';
    const found = checkSource('admin/slices/usage/components/usage/Line.vue', src);
    expect(found.filter((f) => f.rule === 'L1').length).toBe(1);
  });

  test('a call inside a template literal is found', () => {
    const src = 'const title = `modified ${new Date(x).toLocaleString()}`;\n';
    expect(rules(checkSource(ADMIN_FILE, src))).toEqual(['L1']);
  });

  test('a name that only appears in a comment is not a finding', () => {
    const src = [
      '// was: d.toLocaleString()',
      '/* Intl.DateTimeFormat throws on NaN,',
      '   and localeCompare( is not used here */',
      '/** `toLocaleDateString()` — see the format module. */',
      'const url = "https://example.com/a"; // navigator.language',
      '<!-- {{ n.toLocaleString() }} -->',
      'const ok = 1;',
    ].join('\n');
    expect(checkSource(ADMIN_FILE, src)).toEqual([]);
  });

  test('a comment marker inside a string does not hide the code after it', () => {
    const src = 'const u = "https://x.test"; const s = d.toLocaleString();\n';
    expect(rules(checkSource(ADMIN_FILE, src))).toEqual(['L1']);
  });

  test('an import of the name is not a call', () => {
    const src = "import { useTimeAgoIntl } from '@vueuse/core';\n";
    expect(checkSource(ADMIN_FILE, src)).toEqual([]);
  });

  test('a longer identifier that merely contains the name is not a finding', () => {
    const src = 'const a = myuseTimeAgo(x); const b = notIntl.DateTimeFormat;\n';
    expect(checkSource(ADMIN_FILE, src)).toEqual([]);
  });

  test('the format module may make the call — through the allowlist', () => {
    const src = 'const f = new Intl.DateTimeFormat("en-US");\n';
    const allow: AllowEntry[] = [
      { file: ADMIN_MODULE, rule: 'L1', reason: 'the admin format module' },
      { file: APP_MODULE, rule: 'L1', reason: 'the app format module' },
    ];
    const raw = [...checkSource(ADMIN_MODULE, src), ...checkSource(APP_MODULE, src)];
    expect(raw.length).toBe(2);
    expect(applyAllowlist(raw, allow)).toEqual([]);
  });

  test("one console's module is not excused by the other's entry", () => {
    const src = 'const f = new Intl.DateTimeFormat("en-US");\n';
    const allow: AllowEntry[] = [
      { file: ADMIN_MODULE, rule: 'L1', reason: 'the admin format module' },
    ];
    const left = applyAllowlist(
      [...checkSource(ADMIN_MODULE, src), ...checkSource(APP_MODULE, src)],
      allow,
    );
    expect(left.map((f) => f.file)).toEqual([APP_MODULE]);
  });
});

// --------------------------------------------------------------- allowlist

describe('allowlist', () => {
  const finding: Finding = {
    rule: 'L1',
    file: ADMIN_FILE,
    line: 3,
    found: 'd.toLocaleString()',
    fix: 'use the format module',
  };

  test('an entry excuses its file and rule only', () => {
    const other: Finding = { ...finding, file: APP_FILE };
    const left = applyAllowlist(
      [finding, other],
      [{ file: ADMIN_FILE, rule: 'L1', reason: 'fixture' }],
    );
    expect(left).toEqual([other]);
  });

  test('an entry with `match` excuses only that text', () => {
    const enter: Finding = { ...finding, rule: 'L5', found: 'Enter' };
    const hello: Finding = { ...finding, rule: 'L5', found: 'Hello' };
    const left = applyAllowlist(
      [enter, hello],
      [{ file: ADMIN_FILE, rule: 'L5', match: 'Enter', reason: 'a key cap' }],
    );
    expect(left).toEqual([hello]);
  });

  test('an entry that excuses nothing is itself a finding', () => {
    const left = applyAllowlist(
      [],
      [{ file: 'admin/slices/gone/file.ts', rule: 'L1', reason: 'left behind' }],
    );
    expect(left.length).toBe(1);
    expect(left[0]!.rule).toBe('allowlist');
    expect(left[0]!.file).toBe('admin/slices/gone/file.ts');
    expect(left[0]!.found.includes('left behind')).toBe(true);
  });

  test('an entry without a reason is a finding', () => {
    const left = applyAllowlist(
      [finding],
      [{ file: ADMIN_FILE, rule: 'L1', reason: '  ' }],
    );
    expect(rules(left)).toEqual(['L1', 'allowlist']);
  });
});

// ------------------------------------------------------------ run and exit

const sandboxes: string[] = [];

function sandbox(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'locale-check-'));
  sandboxes.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return root;
}

afterAll(() => {
  for (const root of sandboxes) rmSync(root, { recursive: true, force: true });
});

const CLEAN = {
  'admin/slices/chat/utils/transcript.ts': 'export const a = 1;\n',
  'app/slices/chat/utils/transcript.ts': 'export const b = 2;\n',
  'api/src/slices/agent/peer/peerSelf.tool.ts': 'export const c = 3;\n',
};

describe('run', () => {
  test('a clean tree passes and says how many files it read', () => {
    const result = run(sandbox(CLEAN), []);
    expect(result.findings).toEqual([]);
    expect(result.files).toBe(3);
    expect(exitCode(result)).toBe(0);
    expect(render(result)).toBe('locale: 3 files checked, no findings.');
  });

  test('findings fail with code 1 and are all printed', () => {
    const result = run(
      sandbox({
        ...CLEAN,
        'admin/slices/chat/utils/transcript.ts':
          'export const a = (d: Date) => d.toLocaleString();\n',
        'app/slices/share/components/share/panel/Provider.vue':
          '<script setup lang="ts">\nconst s = d.toLocaleDateString(locale.value);\n</script>\n',
      }),
      [],
    );
    expect(exitCode(result)).toBe(1);
    expect(result.findings.length).toBe(2);
    const out = render(result);
    expect(out.includes('admin/slices/chat/utils/transcript.ts:1  L1')).toBe(true);
    expect(
      out.includes('app/slices/share/components/share/panel/Provider.vue:2  L1'),
    ).toBe(true);
    expect(out.includes('locale: 2 findings in 2 files (L1: 2). 4 files checked.')).toBe(
      true,
    );
  });

  test('tests and generated files in the tree are skipped', () => {
    const result = run(
      sandbox({
        ...CLEAN,
        'admin/slices/chat/utils/transcript.test.ts': 'd.toLocaleString();\n',
        'app/slices/setup/api/data/repositories/api/sdk.gen.ts': 'd.toLocaleString();\n',
        'admin/slices/chat/node_modules/x/index.ts': 'd.toLocaleString();\n',
      }),
      [],
    );
    expect(result.findings).toEqual([]);
    expect(result.files).toBe(3);
  });

  test('api sources other than tools are not read', () => {
    const result = run(
      sandbox({
        ...CLEAN,
        'api/src/slices/bridle/domain/attachmentBlocks.ts':
          "const s = n.toLocaleString('en-US');\n",
      }),
      [],
    );
    expect(result.findings).toEqual([]);
    expect(result.files).toBe(3);
  });

  test('a missing root is code 2, never a pass', () => {
    const result = run(
      sandbox({ 'admin/slices/chat/utils/transcript.ts': 'export const a = 1;\n' }),
      [],
    );
    expect(result.missing).toEqual(['app/slices', 'api/src']);
    expect(exitCode(result)).toBe(2);
    expect(render(result).includes('could not run')).toBe(true);
  });

  test('a root with nothing to read is code 2', () => {
    const root = sandbox({
      'admin/slices/README.md': 'empty\n',
      'app/slices/README.md': 'empty\n',
      'api/src/README.md': 'empty\n',
    });
    const result = run(root, []);
    expect(result.files).toBe(0);
    expect(exitCode(result)).toBe(2);
  });

  test('the allowlist is applied, and a stale entry fails the run', () => {
    const root = sandbox({
      ...CLEAN,
      'admin/slices/common/utils/format.ts':
        "export const f = new Intl.DateTimeFormat('en-US');\n",
    });
    const allow: AllowEntry[] = [
      { file: ADMIN_MODULE, rule: 'L1', reason: 'the admin format module' },
    ];
    expect(exitCode(run(root, allow))).toBe(0);

    const stale = run(root, [
      ...allow,
      { file: APP_MODULE, rule: 'L1', reason: 'the app format module' },
    ]);
    expect(exitCode(stale)).toBe(1);
    expect(rules(stale.findings)).toEqual(['allowlist']);
  });
});

// ---------------------------------------------------------------------- L2

describe('L2 — admin source is written in Latin script', () => {
  const file = 'admin/slices/chat/components/chat/detail/MetaCard.vue';
  const l2 = (src: string, path = file) =>
    checkSource(path, src).filter((f) => f.rule === 'L2');

  test('Cyrillic, Greek and CJK letters are findings', () => {
    expect(l2('<p>Привет</p>\n').length).toBe(1);
    expect(l2('const label = "Σύνολο";\n').length).toBe(1);
    expect(l2('const label = "合計";\n').length).toBe(1);
  });

  test('a finding names the line and shows it', () => {
    const [finding] = l2('<template>\n  <p>Сохранено</p>\n</template>\n');
    expect(finding!.line).toBe(2);
    expect(finding!.found).toBe('<p>Сохранено</p>');
  });

  test('one finding per line, however many letters', () => {
    expect(l2('const a = "один"; const b = "два";\nconst c = "три";\n').length).toBe(2);
  });

  test('a comment counts: admin source is read by the whole team', () => {
    expect(l2('// только для текущего пода\nconst a = 1;\n').length).toBe(1);
  });

  test('punctuation, symbols and accented Latin letters are not', () => {
    const src = [
      'const dash = "a — b … «c» · d ⚠ ✓ − × → ₴ €";',
      'const micro = "12 µs";',
      'const name = "café naïve Zoë Łódź";',
      'const emoji = "🤖";',
    ].join('\n');
    expect(l2(src)).toEqual([]);
  });

  test('the rule is about admin: app and api may carry any script', () => {
    const src = 'const hint = "1 слот, 2 слота, 5 слотов";\n';
    expect(l2(src, 'app/slices/setup/i18n/i18n/i18n.config.ts')).toEqual([]);
    expect(l2(src, 'api/src/slices/agent/peer/peerSelf.tool.ts')).toEqual([]);
  });
});

// ---------------------------------------------------------------------- L3

describe('L3 — admin has one language and does not ask the browser', () => {
  const config = 'admin/slices/setup/i18n/nuxt.config.ts';
  const vueI18n = 'admin/slices/setup/i18n/i18n/i18n.config.ts';
  const l3 = (src: string, path = config) =>
    checkSource(path, src).filter((f) => f.rule === 'L3');

  test('the setup as it is passes', () => {
    const src = [
      'export default defineNuxtConfig({',
      "  modules: ['@nuxtjs/i18n'],",
      '  i18n: {',
      "    strategy: 'no_prefix',",
      "    defaultLocale: 'en',",
      "    locales: [{ code: 'en', file: 'en.json' }],",
      '  },',
      '});',
    ].join('\n');
    expect(l3(src)).toEqual([]);
    expect(
      l3("export default defineI18nConfig(() => ({ legacy: false, locale: 'en' }));\n", vueI18n),
    ).toEqual([]);
  });

  test('browser detection is a finding', () => {
    const src = '  i18n: {\n    detectBrowserLanguage: { useCookie: true },\n  },\n';
    const found = l3(src);
    expect(found.length).toBe(1);
    expect(found[0]!.line).toBe(2);
  });

  test('a default or fallback language other than English is a finding', () => {
    expect(l3("    defaultLocale: 'ru',\n").length).toBe(1);
    expect(l3('    defaultLocale: "de",\n').length).toBe(1);
    expect(l3("  locale: 'ru',\n  fallbackLocale: 'ru',\n", vueI18n).length).toBe(2);
  });

  test('a second language in the list of locales is a finding', () => {
    const src =
      "    locales: [{ code: 'en', file: 'en.json' }, { code: 'ru', file: 'ru.json' }],\n";
    expect(l3(src, 'admin/slices/common/nuxt.config.ts').length).toBe(1);
  });

  test('only configuration files are read for this', () => {
    const src = "const option = { locale: 'ru', code: 'ru' };\n";
    expect(l3(src, 'admin/slices/chat/utils/transcript.ts')).toEqual([]);
  });

  test('app may detect the browser and offer Russian', () => {
    const src = "    defaultLocale: 'en',\n    detectBrowserLanguage: { useCookie: true },\n";
    expect(l3(src, 'app/slices/setup/i18n/nuxt.config.ts')).toEqual([]);
  });

  test('a locale file other than en.json under admin is a finding', () => {
    const root = sandbox({
      ...CLEAN,
      'admin/slices/common/i18n/locales/en.json': '{}\n',
      'admin/slices/common/i18n/locales/ru.json': '{}\n',
      'app/slices/common/i18n/locales/ru.json': '{}\n',
    });
    const result = run(root, []);
    expect(result.findings.map((f) => `${f.rule} ${f.file}`)).toEqual([
      'L3 admin/slices/common/i18n/locales/ru.json',
    ]);
    expect(exitCode(result)).toBe(1);
  });
});

// ---------------------------------------------------------------------- L4

describe('L4 — agent tool metadata is written in Latin script', () => {
  const file = 'api/src/slices/agent/peer/peerSelf.tool.ts';
  const l4 = (src: string, path = file) =>
    checkSource(path, src).filter((f) => f.rule === 'L4');

  const tool = (fields: string) =>
    ['  @Tool({', "    name: 'import_my_peer_by_address',", fields, '  })'].join('\n');

  test('an English tool passes', () => {
    const src = tool(
      [
        "    title: 'Import a peer by address',",
        "    template: 'Add the external agent at «url» as your peer',",
        '    description:',
        "      'Take an A2A agent from outside this Ranch as your colleague. ' +",
        "      'The request may come in any language.',",
      ].join('\n'),
    );
    expect(l4(src)).toEqual([]);
  });

  test('a Cyrillic letter in the title, the template or the description is a finding', () => {
    expect(l4(tool("    title: 'Импорт агента',")).length).toBe(1);
    expect(l4(tool("    template: 'Добавь агента «url»',")).length).toBe(1);
    expect(l4(tool('    description: "Подключает агента",')).length).toBe(1);
  });

  test('a description split over several literals is read as one', () => {
    const src = tool(
      [
        '    description:',
        "      'Take an A2A agent as your colleague: when someone says ' +",
        '      \'"connect this", "подключи" or "add this agent" \' +',
        "      'with an address, call this.',",
      ].join('\n'),
    );
    const found = l4(src);
    expect(found.length).toBe(1);
    expect(found[0]!.line).toBe(5);
    expect(found[0]!.found.includes('подключи')).toBe(true);
  });

  test('a template literal is read too', () => {
    expect(l4(tool('    description: `Подключает агента`,')).length).toBe(1);
  });

  test('the same letter outside those three fields is not a finding', () => {
    const src = [
      '// только для текущего пода',
      tool("    title: 'Import a peer by address',"),
      "const sample = 'подключи';",
      "const other = { label: 'Импорт' };",
    ].join('\n');
    expect(l4(src)).toEqual([]);
  });

  test('only tool files are read', () => {
    const src = tool("    title: 'Импорт агента',");
    expect(l4(src, 'api/src/slices/agent/peer/domain/delegation.service.ts')).toEqual([]);
    expect(l4(src, 'admin/slices/agent/toolCatalog/utils/filterCatalog.ts')).toEqual([]);
  });
});

// ---------------------------------------------------------------------- L5

describe('L5 — app interface text goes through translation', () => {
  const file = 'app/slices/agent/components/agent/Item.vue';
  const sfc = (template: string, script = '') =>
    `<script setup lang="ts">\n${script}\n</script>\n\n<template>\n${template}\n</template>\n`;
  const l5 = (src: string, path = file) =>
    checkSource(path, src).filter((f) => f.rule === 'L5');

  test('a text node with a letter is a finding', () => {
    const found = l5(sfc('  <p>Hello</p>'));
    expect(found.length).toBe(1);
    expect(found[0]!.found).toBe('Hello');
    expect(found[0]!.line).toBe(6);
  });

  test('text beside an interpolation is a finding, the interpolation is not', () => {
    const found = l5(sfc('  <p>{{ count }} files · {{ size }}</p>'));
    expect(found.map((f) => f.found)).toEqual(['files ·']);
  });

  test('static attributes that are read aloud or shown are findings', () => {
    for (const name of ['placeholder', 'title', 'aria-label', 'alt', 'label']) {
      const found = l5(sfc(`  <input ${name}="Search agents" />`));
      expect(found.length).toBe(1);
      expect(found[0]!.found).toBe(`${name}="Search agents"`);
    }
  });

  test('translated and bound text passes', () => {
    const template = [
      "  <h1>{{ $t('list.title') }}</h1>",
      '  <input :placeholder="$t(\'rail.search\')" :title="hint" />',
      '  <span>{{ agent.name }}</span>',
      '  <i18n-t keypath="chat.input_hint" tag="p"><kbd>{{ key }}</kbd></i18n-t>',
    ].join('\n');
    expect(l5(sfc(template))).toEqual([]);
  });

  test('whitespace, punctuation, symbols and digits alone pass', () => {
    const template = [
      '  <span>·</span>',
      '  <span> — </span>',
      '  <span>+{{ added }} −{{ removed }}</span>',
      '  <span>✓ {{ label }}</span>',
      '  <span>100%</span>',
      '  <span>&nbsp;</span>',
    ].join('\n');
    expect(l5(sfc(template))).toEqual([]);
  });

  test('other attributes pass: classes, ids, types, test hooks', () => {
    const template =
      '  <button type="button" class="rounded px-2" id="send" data-testid="send-button" name="send" />';
    expect(l5(sfc(template))).toEqual([]);
  });

  test('an expression with `>` and a multi-line attribute do not confuse it', () => {
    const template = [
      '  <p v-if="count > 1 && size < limit">{{ $t(\'x.y\') }}</p>',
      '  <button',
      '    type="button"',
      '    :class="[',
      "      active ? 'bg-primary' : 'bg-muted',",
      '    ]"',
      '    title="Close"',
      '  />',
    ].join('\n');
    const found = l5(sfc(template));
    expect(found.map((f) => f.found)).toEqual(['title="Close"']);
    expect(found[0]!.line).toBe(12);
  });

  test('comments in the template are not text', () => {
    expect(l5(sfc('  <!-- Shimmer status while the agent works -->\n  <div />'))).toEqual([]);
  });

  test('the script is not the template', () => {
    expect(l5(sfc('  <div />', "const label = 'Plain English in script';"))).toEqual([]);
  });

  test('a component with no template passes', () => {
    expect(l5('<script setup lang="ts">\nconst a = 1;\n</script>\n')).toEqual([]);
  });

  test('the rule is about app: admin is written in plain English', () => {
    const src = sfc('  <p>Saved</p>');
    expect(l5(src, 'admin/slices/setting/components/setting/Form.vue')).toEqual([]);
  });

  test('a key cap is excused by text, and only that text', () => {
    const src = sfc('  <kbd>Enter</kbd>\n  <p>Press it</p>');
    const path = 'app/slices/bridle/components/bridle/chat/Input.vue';
    const left = applyAllowlist(checkSource(path, src), [
      { file: path, rule: 'L5', match: 'Enter', reason: 'the label printed on the key' },
    ]);
    expect(left.map((f) => f.found)).toEqual(['Press it']);
  });
});
