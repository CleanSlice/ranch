// CLEAN-205 / US3: the New skill form — slug from the title, hand-edited slug
// sticks, format and taken-name errors, the local draft, Ctrl+S and the
// redirect with ?skill=. Creates `e2e-form-<stamp>` and deletes it after.
//   PLAYWRIGHT_DIR=~/pw node specs/025-skills-redesign/e2e/form.mjs
import { ADMIN, checker, launch, login, newPage, sleep } from './lib.mjs';

const { check, done } = checker();
const browser = await launch();
const stamp = String(Date.now() % 100000);
const slug = `e2e-form-${stamp}`;

try {
  const page = await newPage(browser, { width: 1440, height: 900 });
  await login(page);
  await page.goto(ADMIN + '/skills', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-skill-row]');
  const taken = await page.locator('[data-skill-row]').first().getAttribute('data-skill-row');

  await page.goto(ADMIN + '/skills/create', { waitUntil: 'networkidle' });
  await page.waitForSelector('#title');
  check('submit disabled on an empty form', await page.locator('[data-action="submit"]').isDisabled());

  await page.fill('#title', `E2E Form ${stamp}!`);
  await sleep(400);
  check('slug follows the title', (await page.inputValue('#name')) === slug);
  check('folder hint', (await page.locator('#name-hint').textContent())?.includes(`Folder: .agent/skills/${slug}/`));

  await page.fill('#name', 'Bad Slug!');
  await sleep(100);
  check('format error', (await page.locator('#name-hint').textContent())?.includes('Use lowercase letters, digits and dashes'));
  check('aria-invalid on the slug', (await page.locator('#name').getAttribute('aria-invalid')) === 'true');

  await page.fill('#name', taken);
  await sleep(700);
  check('taken name error', (await page.locator('#name-hint').textContent())?.includes('This name is taken'));
  check('submit disabled with a taken name', await page.locator('[data-action="submit"]').isDisabled());

  await page.fill('#name', slug);
  await page.fill('#title', `E2E Form ${stamp} renamed`);
  await sleep(400);
  check('hand-edited slug no longer follows the title', (await page.inputValue('#name')) === slug);

  await page.selectOption('#group', 'routing');
  await page.fill('#description', 'x'.repeat(150));
  check('description counter turns red past 140', await page.locator('[data-description-count].text-destructive').count() === 1);
  await page.fill('#description', 'A skill written by the e2e script.');
  await page.fill('#body', '# E2E\n\nOne\nTwo');
  await sleep(300);
  check('line counter', (await page.locator('[data-body-lines]').textContent()) === '4');
  check('row preview shows the slug', (await page.locator('[data-skill-preview="row"]').textContent())?.includes(slug));
  check('markdown preview renders the heading', await page.locator('[data-skill-preview="markdown"] h1').count() === 1);

  // Draft survives a reload.
  await sleep(800);
  check('draft label', (await page.locator('[data-skill-draft]').textContent())?.trim().startsWith('Draft · edited'));
  page.once('dialog', (d) => d.accept());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#title');
  await sleep(300);
  check('draft restored after reload', (await page.inputValue('#name')) === slug && (await page.inputValue('#body')).includes('# E2E'));

  // Ctrl+S creates and redirects.
  await sleep(700);
  check('submit enabled when valid', !(await page.locator('[data-action="submit"]').isDisabled()));
  await page.keyboard.press('Control+s');
  await page.waitForURL((u) => u.pathname === '/skills', { timeout: 15000 });
  check('redirect to the library with ?skill', new URL(page.url()).searchParams.get('skill') === slug);
  await sleep(600);
  check('toast', await page.getByText(`Skill ${slug} created`).count() > 0);
  check('new skill selected in the panel', (await page.locator('[data-skill-panel] h2').textContent())?.includes('renamed'));
  check('draft removed after create', await page.evaluate((s) => !Object.keys(localStorage).some((k) => k.endsWith(`.${s}`)), slug));

  // Clean up through the panel.
  await page.locator('[data-action="start-delete"]').click();
  check('inline delete sentence', (await page.locator('[data-skill-delete-confirm]').textContent())?.includes(`Delete ${slug}? It is not in any template.`));
  await page.locator('[data-action="delete"]').click();
  await sleep(600);
  check('deleted', await page.locator(`[data-skill-row="${slug}"]`).count() === 0);
} finally {
  await browser.close();
  done();
}
