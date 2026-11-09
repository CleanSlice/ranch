// Lighthouse + bundle size for the landing (research R6, R7).
//
//   node specs/026-app-console-redesign/e2e/measure.mjs --label P0 [--runs 3] [--url http://localhost:3000/]
//   node specs/026-app-console-redesign/e2e/measure.mjs --compare P0 P1 P2
//
// Needs a production build served on the url (`cd app && bun run build && bun run preview`)
// and the API up, so the hero Stage gets its public-agent answer. Runs lighthouse@12
// via npx with the installed Chrome (CHROME_PATH), `--runs` times per profile
// (desktop preset and default mobile), and keeps the median run by Performance.
// JS size = gzip of every _nuxt/*.js the page loaded, read from app/.output/public.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, basename } from 'node:path';
import { gzipSync } from 'node:zlib';
import { CHROME, FEATURE, REPO, arg, ensureDir } from './lib.mjs';

const dir = ensureDir(resolve(FEATURE, 'measurements'));
const compareIdx = process.argv.indexOf('--compare');

if (compareIdx !== -1) {
  const labels = process.argv.slice(compareIdx + 1).filter((a) => !a.startsWith('--'));
  compare(labels);
  process.exit(0);
}

const label = String(arg('label', ''));
if (!label) {
  console.error('usage: measure.mjs --label P0 | --compare P0 P1 P2');
  process.exit(2);
}
const url = String(arg('url', 'http://localhost:3000/'));
const runs = Number(arg('runs', 3));
const nuxtDir = resolve(REPO, 'app/.output/public/_nuxt');

function lighthouse(profile) {
  const tmp = mkdtempSync(resolve(tmpdir(), 'lh-'));
  const outPath = resolve(tmp, 'report.json');
  const args = [
    'lighthouse@12',
    url,
    '--quiet',
    '--output=json',
    `--output-path=${outPath}`,
    '--chrome-flags=--headless=new --no-sandbox',
    '--only-categories=performance',
  ];
  if (profile === 'desktop') args.push('--preset=desktop');
  const res = spawnSync('npx', args, {
    shell: true,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, CHROME_PATH: CHROME },
    timeout: 240_000,
  });
  if (res.status !== 0 || !existsSync(outPath)) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`lighthouse (${profile}) failed with status ${res.status}`);
  }
  const json = JSON.parse(readFileSync(outPath, 'utf8'));
  rmSync(tmp, { recursive: true, force: true });
  return summarize(json);
}

function lcpSelector(json) {
  const audit = json.audits['largest-contentful-paint-element'];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (node.node?.selector) return node.node.selector;
    if (Array.isArray(node)) for (const n of node) { const s = walk(n); if (s) return s; }
    else for (const v of Object.values(node)) { const s = walk(v); if (s) return s; }
    return null;
  };
  return walk(audit?.details) ?? null;
}

function summarize(json) {
  const a = json.audits;
  const requests = a['network-requests']?.details?.items ?? [];
  const scripts = requests.filter((r) => r.resourceType === 'Script');
  const transfer = scripts.reduce((s, r) => s + (r.transferSize || 0), 0);
  let gzip = 0;
  const files = [];
  for (const r of scripts) {
    const m = String(r.url).match(/\/_nuxt\/([^?#]+\.js)/);
    if (!m) continue;
    const file = resolve(nuxtDir, m[1]);
    if (!existsSync(file)) continue;
    const bytes = gzipSync(readFileSync(file), { level: 9 }).length;
    gzip += bytes;
    files.push({ file: basename(file), gzip: bytes });
  }
  return {
    performance: Math.round((json.categories.performance.score ?? 0) * 100),
    lcpMs: Math.round(a['largest-contentful-paint']?.numericValue ?? 0),
    lcpElement: lcpSelector(json),
    cls: Number((a['cumulative-layout-shift']?.numericValue ?? 0).toFixed(3)),
    tbtMs: Math.round(a['total-blocking-time']?.numericValue ?? 0),
    fcpMs: Math.round(a['first-contentful-paint']?.numericValue ?? 0),
    jsTransferBytes: transfer,
    jsGzipBytes: gzip,
    jsFiles: files,
    lighthouse: json.lighthouseVersion,
  };
}

function median(list) {
  const sorted = [...list].sort((x, y) => x.performance - y.performance);
  return sorted[Math.floor(sorted.length / 2)];
}

const result = { label, url, runs, at: new Date().toISOString(), commit: gitHead(), desktop: null, mobile: null };
for (const profile of ['desktop', 'mobile']) {
  const all = [];
  for (let i = 0; i < runs; i += 1) {
    console.log(`-- ${label} ${profile} run ${i + 1}/${runs}`);
    all.push(lighthouse(profile));
  }
  result[profile] = { ...median(all), scores: all.map((r) => r.performance) };
}
writeFileSync(resolve(dir, `${label}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(`wrote measurements/${label}.json`);
compare([label]);

function gitHead() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' });
  return (r.stdout || '').trim();
}

function compare(labels) {
  const rows = labels.map((l) => {
    const p = resolve(dir, `${l}.json`);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  });
  const cell = (r, f) => (r ? f(r) : '—');
  console.log('');
  console.log(`| Metric | ${labels.join(' | ')} |`);
  console.log(`|---|${labels.map(() => '---').join('|')}|`);
  const line = (name, f) => console.log(`| ${name} | ${rows.map((r) => cell(r, f)).join(' | ')} |`);
  line('commit', (r) => r.commit);
  line('Performance desktop', (r) => `${r.desktop.performance} (${r.desktop.scores.join('/')})`);
  line('Performance mobile', (r) => `${r.mobile.performance} (${r.mobile.scores.join('/')})`);
  line('LCP desktop ms / element', (r) => `${r.desktop.lcpMs} / ${r.desktop.lcpElement ?? '?'}`);
  line('LCP mobile ms / element', (r) => `${r.mobile.lcpMs} / ${r.mobile.lcpElement ?? '?'}`);
  line('CLS desktop / mobile', (r) => `${r.desktop.cls} / ${r.mobile.cls}`);
  line('TBT desktop / mobile ms', (r) => `${r.desktop.tbtMs} / ${r.mobile.tbtMs}`);
  line('JS gzip bytes (landing)', (r) => String(r.desktop.jsGzipBytes));
  if (rows.length > 1 && rows.every(Boolean)) {
    const first = rows[0], last = rows[rows.length - 1];
    console.log('');
    console.log(`JS gzip delta ${labels[0]} → ${labels[labels.length - 1]}: ${last.desktop.jsGzipBytes - first.desktop.jsGzipBytes} bytes`);
  }
}
