// CLEAN-102 / US1 scenario 1: ask in the landing-page chat, move to the agent page mid-answer.
import { launch, newPage, login, APP, sleep } from './lib.mjs';

const bubbles = (page) =>
  page.$$eval('[data-message-id]', (els) =>
    els.map((el) => ({ role: el.getAttribute('data-role'), delivery: el.getAttribute('data-delivery'), text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 50) })),
  );

const browser = await launch();
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
try {
  const page = await newPage(browser);
  await login(page, APP);
  await page.goto(APP + '/', { waitUntil: 'networkidle' });
  await sleep(2500);
  const hasChat = await page.locator('textarea').count();
  if (!hasChat) {
    console.log('SKIP  the landing page shows no live chat (no featured public agent on this stack)');
  } else {
    const q = `Главная ${Date.now() % 100000}. Перечисли пять фактов о лошадях, по одному предложению.`;
    const box = page.locator('textarea').last();
    await box.fill(q);
    await box.press('Enter');
    await sleep(900); // the agent has started, the answer has not finished
    const agentLink = page.locator('a[href^="/agents/agent-"]').first();
    const href = (await agentLink.count()) ? await agentLink.getAttribute('href') : null;
    const target = href ?? (await page.evaluate(() => {
      const el = document.querySelector('[data-message-id]');
      return null;
    }));
    if (!target) {
      // No link on the landing page — navigate client-side the way a NuxtLink would.
      const id = await page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith('bridle:conversation:'))?.split(':').pop());
      check('found the conversation key to navigate to', !!id, String(id));
      await page.evaluate((agentId) => window.useNuxtApp?.().$router.push(`/agents/${agentId}`), id);
    } else {
      await agentLink.click();
    }
    await page.waitForURL(/\/agents\//, { timeout: 15000 }).catch(() => undefined);
    console.log('now at', new URL(page.url()).pathname);
    await sleep(15000);
    const list = await bubbles(page);
    const mine = list.filter((b) => b.text.includes(q.slice(0, 12)));
    check('the question asked on the landing page is in the agent chat, once', mine.length === 1, `count=${mine.length}`);
    check('it is delivered', mine[0]?.delivery === 'delivered', String(mine[0]?.delivery));
    const qi = list.findIndex((b) => b.text.includes(q.slice(0, 12)));
    check('the answer arrived after the move, below the question', list.slice(qi + 1).some((b) => b.role !== 'user'), `${list.length} bubbles`);
    const reconnecting = await page.getByText(/Reconnecting|Переподключ/i).count();
    check('no "Reconnecting…" banner', reconnecting === 0);
    await page.screenshot({ path: 'handoff-app.png' });
  }
} catch (err) {
  failed++;
  console.log('ERROR', String(err).slice(0, 300));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
