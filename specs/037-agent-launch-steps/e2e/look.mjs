// How the launch step list looks and sits, in both consoles (CLEAN-247).
//
//   node specs/037-agent-launch-steps/e2e/look.mjs
//
// A launch is brought to "preparing the container" (rows above and below the
// current one) and to a failure, at 390 px and 1440 px, and each state is
// photographed. Screenshots go outside the repo (`SHOTS` in lib.mjs).
//
// The admin console ships one theme (light) and the app console one (dark):
// each is photographed as it ships. The admin's `.dark` tokens exist with no
// switch to reach them, so they are photographed by putting the class on.
import {
  CONSOLES,
  POD,
  REASON,
  SHOTS,
  check,
  consolePage,
  done,
  launch,
  launchAttr,
  openChat,
  overlayKind,
  runtime,
  section,
  shot,
  stage,
  until,
  waitRows,
} from './lib.mjs';

const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
];

const AT_CONTAINER =
  'accepted:done stopped:done scheduled:done container:current online:upcoming ready:upcoming';

/** Brings a restart to the container step, whichever console it is. */
async function toContainer(which, page, st, rt) {
  await st.push({ pod: POD.ready, hub: true });
  await until(async () => (await overlayKind(page)) === null, { timeout: 15000 });
  if (which.name === 'admin') {
    await page.locator('[data-agent-actions]').first().click();
    await page.getByRole('menuitem', { name: /^Restart/ }).first().click();
  } else {
    st.set({ status: 'deploying', launchContext: 'restart' });
    await st.push({ pod: POD.old, hub: true });
  }
  await until(async () => (await overlayKind(page)) === 'starting', { timeout: 8000 });
  await rt.down();
  await st.push({ pod: POD.old, hub: false });
  await st.push({ pod: POD.creating });
  return (await waitRows(page, AT_CONTAINER)).ok;
}

/** What the overlay covers, and what it must leave alone. */
function geometry(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector('[data-chat-overlay]');
    const composer = document.querySelector('textarea');
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const texts = [...document.querySelectorAll('[data-step] span')];
    const root = document.documentElement;
    return {
      overlay: box(overlay),
      composer: box(composer),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      sideways: root.scrollWidth > root.clientWidth,
      // A row whose text is wider than its box is cut off.
      clipped: texts.filter((el) => el.scrollWidth > el.clientWidth + 1).length,
      // Rows the person can actually see inside the overlay.
      visibleRows: [...document.querySelectorAll('[data-step]')].filter((el) => {
        const r = el.getBoundingClientRect();
        const o = overlay?.getBoundingClientRect();
        return o && r.top >= o.top - 1 && r.bottom <= o.bottom + 1 && Number(getComputedStyle(el).opacity) > 0;
      }).length,
      current: (() => {
        const el = document.querySelector('[data-step-state="current"], [data-step-state="failed"]');
        const o = overlay?.getBoundingClientRect();
        if (!el || !o) return false;
        const r = el.getBoundingClientRect();
        return r.top >= o.top && r.bottom <= o.bottom && r.left >= o.left && r.right <= o.right;
      })(),
    };
  });
}

async function lookAt(browser, which, size, { reduced = false, locale = null, dark = false } = {}) {
  const tag = [which.name, size.width, dark ? 'dark-class' : null, locale, reduced ? 'reduced' : null]
    .filter(Boolean)
    .join('-');
  section(tag);
  const rt = runtime();
  const { page, context, problems } = await consolePage(browser, which, { ...size, reduced, locale });
  const st = await stage(page);
  try {
    await rt.up();
    await openChat(page, which);
    if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
    if (!check(await toContainer(which, page, st, rt), 'a restart is at the container step')) return;

    const g = await geometry(page);
    check(!g.sideways, 'the page does not scroll sideways');
    check(g.clipped === 0, 'no row text is cut off');
    check(g.current, 'the current row is inside the overlay');
    check(g.visibleRows >= 4, `rows before and after it are on screen (${g.visibleRows})`);
    check(
      Boolean(g.overlay && g.composer && g.overlay.bottom <= g.composer.top + 1),
      'the overlay stops above the composer',
    );
    await page.locator('textarea').first().fill('written while it launches');
    check((await page.locator('textarea').first().inputValue()) === 'written while it launches', 'the composer takes text during a launch');

    if (reduced) {
      const motion = await page.evaluate(() => {
        const row = document.querySelector('[data-step-state="current"]');
        const spinner = row?.querySelector('svg');
        return {
          row: row ? getComputedStyle(row).transitionProperty : null,
          spinner: spinner ? getComputedStyle(spinner).animationName : null,
        };
      });
      check(motion.row === 'none', `rows change state with no transition (${motion.row})`);
      check(motion.spinner === 'none', `and the spinner does not spin (${motion.spinner})`);
    }
    if (locale === 'ru') {
      const heading = await page.locator('[data-launch] h3').first().innerText();
      check(/[А-Яа-я]/.test(heading), `the heading follows the language (${heading})`);
    }
    console.log(`  shot  ${await shot(page, `${tag}-launching`)}`);

    st.set({ status: 'failed', statusReason: REASON });
    await st.push({ pod: POD.pullFailed });
    await until(async () => (await launchAttr(page, 'data-launch-outcome')) === 'failed', { timeout: 8000 });
    // The server's reason is on the row, read again once the launch failed.
    let reason = '';
    await until(
      async () => {
        const row = page.locator('[data-step-state="failed"]').first();
        reason = (await row.count()) ? await row.innerText() : '';
        return reason.includes(REASON);
      },
      { timeout: 8000 },
    );
    check(reason.includes(REASON), 'the reason is shown as received, untranslated');
    const failed = await geometry(page);
    check(failed.current, 'the failed row and its reason are inside the overlay');
    check(!failed.sideways, 'still no sideways scroll with the reason shown');
    console.log(`  shot  ${await shot(page, `${tag}-failed`)}`);

    check(problems.length === 0, problems.length === 0 ? 'no console errors, no failed requests' : problems.join(' | '));
  } finally {
    await rt.down();
    await context.close();
  }
}

const browser = await launch();
try {
  for (const which of Object.values(CONSOLES)) {
    for (const size of WIDTHS) await lookAt(browser, which, size);
  }
  await lookAt(browser, CONSOLES.admin, WIDTHS[1], { dark: true });
  await lookAt(browser, CONSOLES.app, WIDTHS[0], { locale: 'ru' });
  await lookAt(browser, CONSOLES.admin, WIDTHS[1], { reduced: true });
  await lookAt(browser, CONSOLES.app, WIDTHS[0], { reduced: true });
} finally {
  await browser.close();
}
console.log(`\nscreenshots: ${SHOTS}`);
done('look');
