// CLEAN-236 scenarios: shared plumbing. Everything here talks to a LOCAL API
// on a scratch database (quickstart.md §2). It refuses anything else: the
// seed deletes agents and connections.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '../../..');
// Client libraries come from the API's own dependencies: nothing to install.
const require = createRequire(path.join(REPO, 'api/package.json'));
export const jwt = require('jsonwebtoken');
export const { io } = require('socket.io-client');

function dotenv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return out;
}

const env = dotenv(path.join(REPO, 'api/.env'));
/** Never printed. The API under test must run with the same two. */
export const JWT_SECRET = process.env.JWT_SECRET ?? env.JWT_SECRET;
export const BRIDLE_API_KEY = process.env.BRIDLE_API_KEY ?? env.BRIDLE_API_KEY;

export const API = (process.env.E2E_API ?? 'http://localhost:3399').replace(/\/+$/, '');
export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  env.DATABASE_URL.replace(/\/[^/?]+(\?.*)?$/, '/ranch_clean236$1');

{
  const host = new URL(API).hostname;
  const db = new URL(DATABASE_URL);
  const local = (h) => h === 'localhost' || h === '127.0.0.1';
  if (!local(host) || !local(db.hostname) || !/clean236|e2e/.test(db.pathname)) {
    throw new Error(
      'These scenarios seed and delete: they run against a local API and a ' +
        'scratch database whose name contains "clean236" or "e2e" only.',
    );
  }
}

let prismaClient;
/** The scratch database, for what no route can set up: bare agent rows. */
export function prisma() {
  if (!prismaClient) {
    const { PrismaClient } = require('@prisma/client');
    prismaClient = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  }
  return prismaClient;
}

// ── HTTP ─────────────────────────────────────────────────────────────

/**
 * One request. `data` is the envelope's `data` when there is one. `cookies`
 * is a plain map the caller keeps: a browser profile, as far as the session
 * cookies go.
 */
export async function api(method, route, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.console) headers['X-Ranch-Console'] = opts.console;
  if (opts.cookies && Object.keys(opts.cookies).length) {
    headers.Cookie = Object.entries(opts.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
  const res = await fetch(API + route, {
    method,
    headers,
    redirect: 'manual',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (opts.cookies) {
    for (const line of setCookies) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const gone =
        value === '' ||
        attrs.some((a) => /^\s*(max-age=0|expires=thu, 01 jan 1970)/i.test(a));
      if (gone) delete opts.cookies[name];
      else opts.cookies[name] = value;
    }
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  const data = json && typeof json === 'object' && 'data' in json ? json.data : json;
  return { status: res.status, data, json, text, setCookies };
}

// ── Checks ───────────────────────────────────────────────────────────

const results = [];
let current = '';

export function section(title) {
  current = title;
  console.log(`\n== ${title}`);
}

const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s === undefined ? 'undefined' : s.length > 220 ? s.slice(0, 220) + '…' : s;
};

/** `expected`: a value (deep equality), a RegExp, or a predicate. */
export function check(name, actual, expected) {
  let ok;
  if (expected instanceof RegExp) ok = expected.test(String(actual));
  else if (typeof expected === 'function') ok = Boolean(expected(actual));
  else ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ section: current, name, ok });
  const want =
    typeof expected === 'function' ? '' : ` (expected ${show(expected instanceof RegExp ? String(expected) : expected)})`;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} -> ${show(actual)}${ok ? '' : want}`);
  return ok;
}

/** No part of `haystack` (any JSON) mentions any of `words`. */
export function silentAbout(haystack, words) {
  const text = typeof haystack === 'string' ? haystack : JSON.stringify(haystack ?? null);
  return words.filter((w) => text.includes(w));
}

export function summary() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  for (const f of failed) console.log(`  FAIL [${f.section}] ${f.name}`);
  return failed.length;
}

export async function done() {
  const failed = summary();
  await prismaClient?.$disconnect();
  process.exit(failed ? 1 : 0);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
