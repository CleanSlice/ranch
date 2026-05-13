import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { consola } from "consola";
import { readCache, writeCache } from "./cache";
import { compareSemver } from "./version-check";
import { tryRun } from "./exec";

const REPO = "CleanSlice/Ranch";
const CACHE_FILE = "platform-version-check.json";
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3_000;

interface CachedCheck {
  latest: string;
  checkedAt: number;
}

interface GhTag {
  name: string;
}

function readLocalVersion(root: string): string | null {
  try {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

async function fetchLatest(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/tags?per_page=100`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "cleanslice-ranch-cli",
        },
        signal: controller.signal,
      },
    );
    if (!res.ok) return null;
    const tags = (await res.json()) as GhTag[];
    const versions = tags
      .map((t) => t.name)
      .filter((n) => !n.startsWith("cli-") && n.startsWith("v"))
      .map((n) => n.slice(1))
      .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
      .sort(compareSemver);
    return versions[versions.length - 1] ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getLatestWithCache(): Promise<string | null> {
  const cached = readCache<CachedCheck>(CACHE_FILE);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return cached.latest;
  }
  const latest = await fetchLatest();
  if (latest) {
    writeCache<CachedCheck>(CACHE_FILE, { latest, checkedAt: Date.now() });
  }
  return latest ?? cached?.latest ?? null;
}

function isGitRepo(root: string): boolean {
  return existsSync(join(root, ".git"));
}

interface CheckoutState {
  branch: string | null;
  dirty: boolean;
}

function readCheckoutState(root: string): CheckoutState {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const dirty =
      execSync("git status --porcelain", {
        cwd: root,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().length > 0;
    return { branch, dirty };
  } catch {
    return { branch: null, dirty: true };
  }
}

export async function maybeUpdatePlatform(root: string): Promise<void> {
  if (process.env.RANCH_NO_UPDATE_CHECK === "1") return;
  if (process.env.RANCH_SKIP_PLATFORM_UPDATE === "1") return;
  if (process.env.CI) return;
  if (!isGitRepo(root)) return;

  const local = readLocalVersion(root);
  if (!local) return;

  const latest = await getLatestWithCache();
  if (!latest) return;
  if (compareSemver(latest, local) <= 0) return;

  consola.box(
    `New Ranch version available: v${local} → v${latest}\n` +
      `https://github.com/${REPO}/releases/tag/v${latest}`,
  );

  const { branch, dirty } = readCheckoutState(root);
  if (dirty) {
    consola.warn(
      "Local changes detected — skipping auto-update. Commit/stash them and re-run `ranch dev` to update.",
    );
    return;
  }
  if (branch && branch !== "main" && branch !== "HEAD") {
    consola.warn(
      `On branch '${branch}' (not main) — skipping auto-update.`,
    );
    return;
  }

  if (!process.stdin.isTTY) {
    consola.info("Non-interactive shell — skipping auto-update prompt.");
    return;
  }

  const confirmed = await consola.prompt(
    `Pull v${latest} and continue?`,
    { type: "confirm", initial: true },
  );
  if (confirmed === false || typeof confirmed === "symbol") {
    consola.info(`Continuing on v${local}.`);
    return;
  }

  consola.start("Pulling latest changes…");
  const code = await tryRun("git", ["pull", "--ff-only", "origin", "main"], {
    cwd: root,
  });
  if (code !== 0) {
    consola.warn(
      "git pull failed — continuing on current version. Resolve manually and re-run `ranch dev`.",
    );
    return;
  }

  const afterPull = readLocalVersion(root);
  if (afterPull && compareSemver(afterPull, local) > 0) {
    consola.success(`Updated checkout to v${afterPull}.`);
  } else {
    consola.info("Pull complete.");
  }
}
