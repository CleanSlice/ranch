import pkg from "../../package.json" with { type: "json" };
import { readCache, writeCache } from "./cache";

const REPO = "CleanSlice/Ranch";
const TAG_PREFIX = "cli-v";
const CACHE_FILE = "version-check.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2_000;

export interface VersionCheckResult {
  current: string;
  latest: string;
  hasUpdate: boolean;
  checkedAt: number;
}

interface CachedCheck {
  current: string;
  latest: string;
  checkedAt: number;
}

interface GhTag {
  name: string;
}

export function currentVersion(): string {
  return pkg.version;
}

function parseSemver(v: string): [number, number, number] | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const a = m[1];
  const b = m[2];
  const c = m[3];
  if (a === undefined || b === undefined || c === undefined) return null;
  return [Number(a), Number(b), Number(c)];
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  if (pa[0] !== pb[0]) return pa[0] < pb[0] ? -1 : 1;
  if (pa[1] !== pb[1]) return pa[1] < pb[1] ? -1 : 1;
  if (pa[2] !== pb[2]) return pa[2] < pb[2] ? -1 : 1;
  return 0;
}

export async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/tags?per_page=100`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": `cleanslice-ranch-cli/${pkg.version}`,
        },
        signal: controller.signal,
      },
    );
    if (!res.ok) return null;
    const tags = (await res.json()) as GhTag[];
    const versions = tags
      .map((t) => t.name)
      .filter((n) => n.startsWith(TAG_PREFIX))
      .map((n) => n.slice(TAG_PREFIX.length))
      .filter((v) => parseSemver(v) !== null)
      .sort(compareSemver);
    return versions[versions.length - 1] ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function readCachedCheck(): VersionCheckResult | null {
  const cached = readCache<CachedCheck>(CACHE_FILE);
  if (!cached) return null;
  const current = currentVersion();
  return {
    current,
    latest: cached.latest,
    hasUpdate: compareSemver(cached.latest, current) > 0,
    checkedAt: cached.checkedAt,
  };
}

export function isCacheStale(): boolean {
  const cached = readCache<CachedCheck>(CACHE_FILE);
  if (!cached) return true;
  return Date.now() - cached.checkedAt > CACHE_TTL_MS;
}

export async function refreshCache(): Promise<VersionCheckResult | null> {
  const latest = await fetchLatestVersion();
  if (!latest) return null;
  const current = currentVersion();
  const entry: CachedCheck = { current, latest, checkedAt: Date.now() };
  writeCache(CACHE_FILE, entry);
  return {
    current,
    latest,
    hasUpdate: compareSemver(latest, current) > 0,
    checkedAt: entry.checkedAt,
  };
}
