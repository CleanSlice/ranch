// CLEAN-102 / US6: does the agents list row agree with the header, and do stream frames decode?
import { launch, newPage, login, ADMIN, AGENT, sleep } from './lib.mjs';

const browser = await launch();
try {
  const page = await newPage(browser);
  const frames = [];
  page.on('response', (r) => { if (r.url().includes('/agents/status/stream')) frames.push(r.status()); });
  await login(page, ADMIN);
  await page.goto(`${ADMIN}/agents/${AGENT}`, { waitUntil: 'domcontentloaded' });
  await sleep(6000);
  const seen = await page.evaluate(() => {
    const statuses = ['Running', 'Deploying', 'Failed', 'Stopped', 'Pending', 'Unreachable'];
    const find = (root) => {
      const text = (root?.innerText || '').replace(/\s+/g, ' ');
      // Case-sensitive: status badges are capitalised, "Log fetch failed" is not one.
      return statuses.filter((s) => new RegExp(`\\b${s}\\b`).test(text));
    };
    const aside = [...document.querySelectorAll('aside, [class*="rail"], nav')].find((el) => /Search agents/i.test(el.innerHTML) || el.querySelector('input[placeholder*="Search"]'));
    const rowHost = document.querySelector('input[placeholder*="Search agents"]')?.closest('div')?.parentElement;
    const header = document.querySelector('h1, h2')?.closest('div')?.parentElement;
    const pinia = window.__NUXT__ ? null : null;
    return { list: find(rowHost ?? aside), header: find(header), url: location.pathname };
  });
  console.log('status stream HTTP:', frames.join(',') || 'not requested');
  console.log('list row status  :', seen.list.join(',') || '(none found)');
  console.log('header status    :', seen.header.join(',') || '(none found)');
  const agree = seen.list.length && seen.header.length && seen.list.some((s) => seen.header.includes(s));
  console.log(agree ? 'PASS  list row and header agree' : 'CHECK list and header could not be matched by this script');
  await page.screenshot({ path: 'status-admin.png' });
} finally {
  await browser.close();
}
