// CLEAN-102: leave the agent page mid-answer (SPA navigation), come back — nothing lost, nothing doubled.
import { launch, newPage, login, APP, AGENT, sleep } from './lib.mjs';

const bubbles = (page) =>
  page.$$eval('[data-message-id]', (els) =>
    els.map((el) => ({ role: el.getAttribute('data-role'), delivery: el.getAttribute('data-delivery'), text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 50) })),
  );

const away = Number(process.argv[2] || 1500); // ms spent on the other page
const browser = await launch();
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
try {
  const page = await newPage(browser);
  await login(page, APP);
  await page.goto(`${APP}/agents/${AGENT}`, { waitUntil: 'networkidle' });
  await sleep(3000);
  const q = `Уход ${Date.now() % 100000}. Перечисли семь фактов о лошадях, по одному предложению на факт.`;
  const box = page.locator('textarea').last();
  await box.fill(q);
  await box.press('Enter');
  await sleep(1200);
  const link = page.locator('a[href="/agents"]').first();
  check('found an in-app link to leave the page', (await link.count()) > 0);
  await link.click();
  await page.waitForURL((u) => u.pathname === '/agents', { timeout: 10000 });
  console.log(`away for ${away} ms on`, new URL(page.url()).pathname);
  await sleep(away);
  await page.goBack();
  await page.waitForURL(/\/agents\/agent-/, { timeout: 10000 });
  await sleep(20000);
  const list = await bubbles(page);
  const qi = list.findIndex((b) => b.text.includes(q.slice(0, 10)));
  check('the question is there once', list.filter((b) => b.text.includes(q.slice(0, 10))).length === 1);
  check('it is delivered', list[qi]?.delivery === 'delivered', String(list[qi]?.delivery));
  const answers = list.slice(qi + 1).filter((b) => b.role !== 'user');
  check('the answer that finished while away is shown, once', answers.length === 1, `answers after the question: ${answers.length}`);
  check('no "Reconnecting…" banner', (await page.getByText(/Reconnecting|Переподключ/i).count()) === 0);
} catch (err) {
  failed++;
  console.log('ERROR', String(err).slice(0, 300));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
