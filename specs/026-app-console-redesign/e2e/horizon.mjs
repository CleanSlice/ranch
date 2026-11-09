// FR-010: the lit horizon of the hero scene is almost hidden behind the Stage
// panel at 1440x900. Two candidate fixes, rendered side by side for the owner:
//
//   A — raise the scene:     image/video taller and shifted up, glow follows
//   B — reduce the overlap:  the Stage starts lower, so the horizon stays clear
//
//   node specs/026-app-console-redesign/e2e/horizon.mjs --out <dir>
//
// Writes base-<w>.png, A-raise-<w>.png, B-overlap-<w>.png for 1440 and 390
// (fold only — the question is about the first screen).
import { resolve } from 'node:path';
import { APP, arg, ensureDir, launch, newPage, settle } from './lib.mjs';

const out = ensureDir(resolve(String(arg('out', 'specs/026-app-console-redesign/shots/horizon'))));

export const VARIANTS = {
  'A-raise': `
    @media (min-width: 768px) {
      .land-atmo__img, .land-atmo__video { height: 126% !important; top: -26% !important; }
      .land-atmo__glow { top: 50% !important; }
    }`,
  'B-overlap': `
    @media (min-width: 768px) {
      .land-hero__stage { margin-top: 96px !important; }
      .land-hero { min-height: calc(100vh + 96px) !important; }
    }`,
};

const browser = await launch();
for (const [w, h] of [
  [1440, 900],
  [390, 844],
]) {
  for (const [name, css] of [['base', ''], ...Object.entries(VARIANTS)]) {
    const page = await newPage(browser, { width: w, height: h });
    await page.goto(APP + '/', { waitUntil: 'domcontentloaded' });
    if (css) await page.addStyleTag({ content: css });
    await settle(page);
    const file = resolve(out, `${name}-${w}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log('  wrote', file);
    await page.context().close();
  }
}
await browser.close();
