// CLEAN-245 evidence: shared plumbing. Everything here talks to a LOCAL API
// on a scratch database (README.md). It refuses anything else: the seed
// writes agents and accounts.
//
// Secrets come from the environment the API under test was started with
// (`JWT_SECRET`, `BRIDLE_API_KEY`, `E2E_DATABASE_URL`); nothing is read from
// a file here and nothing is printed.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
export const HERE = here;
export const REPO = path.resolve(here, "../../..");
// Client libraries come from the API's own dependencies: nothing to install.
const require = createRequire(path.join(REPO, "api/package.json"));
export const { io } = require("socket.io-client");

function need(name) {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `${name} is not set: start from the stack's environment (README.md)`,
    );
  return value;
}

/** Never printed. The API under test runs with the same one. */
export const BRIDLE_API_KEY = need("BRIDLE_API_KEY");
export const API = (process.env.E2E_API ?? "http://localhost:3345").replace(
  /\/+$/,
  "",
);
export const ADMIN = (process.env.E2E_ADMIN ?? "http://localhost:3105").replace(
  /\/+$/,
  "",
);
export const APP = (process.env.E2E_APP ?? "http://localhost:3104").replace(
  /\/+$/,
  "",
);
/** The fake runtimes' control port (`runtime.mjs`). */
export const CONTROL = (
  process.env.E2E_CONTROL ?? "http://localhost:3346"
).replace(/\/+$/, "");
export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? need("DATABASE_URL");

{
  const local = (h) => h === "localhost" || h === "127.0.0.1";
  const db = new URL(DATABASE_URL);
  if (
    !local(new URL(API).hostname) ||
    !local(db.hostname) ||
    !/e2e/.test(db.pathname)
  ) {
    throw new Error(
      "This evidence seeds accounts and agents: it runs against a local API " +
        'and a scratch database whose name contains "e2e" only.',
    );
  }
}

let prismaClient;
/** The scratch database, for what no route can set up: bare agent rows, an agent's status. */
export function prisma() {
  if (!prismaClient) {
    const { PrismaClient } = require("@prisma/client");
    prismaClient = new PrismaClient({
      datasources: { db: { url: DATABASE_URL } },
    });
  }
  return prismaClient;
}

/** One request; `data` is the envelope's `data` when there is one. */
export async function api(method, route, opts = {}) {
  const headers = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(API + route, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  const data =
    json && typeof json === "object" && "data" in json ? json.data : json;
  return { status: res.status, data, json, text };
}

/** Tell the fake runtimes what to be (`runtime.mjs`). */
export async function control(route, body) {
  const res = await fetch(CONTROL + route, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`control ${route}: ${res.status}`);
  return res.json();
}

const results = [];
/** `expected`: a value (deep equality), a RegExp, or a predicate. */
export function check(name, actual, expected) {
  let ok;
  if (expected instanceof RegExp) ok = expected.test(String(actual));
  else if (typeof expected === "function") ok = Boolean(expected(actual));
  else ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, ok });
  const shown = typeof actual === "string" ? actual : JSON.stringify(actual);
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name} -> ${String(shown).slice(0, 200)}`,
  );
  return ok;
}

export function summary() {
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length} passed, ${failed.length} failed`,
  );
  for (const f of failed) console.log(`  FAIL ${f.name}`);
  return failed.length;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
