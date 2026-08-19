import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { consola } from "consola";
import { hasBinary } from "./bin";
import { run } from "./exec";

export const BROWSER_POOL_IMAGE = "ghcr.io/cleanslice/browser-pool:latest";

const TOKEN_KEYS = ["GITHUB_TOKEN", "GH_TOKEN", "GHCR_PAT", "CR_PAT"] as const;
const USER_KEYS = ["GITHUB_USER", "GH_USER", "GITHUB_USERNAME"] as const;

export function parseDotEnv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function pickGithubToken(
  env: Record<string, string | undefined>,
): string | undefined {
  for (const key of TOKEN_KEYS) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function pickGithubUser(
  env: Record<string, string | undefined>,
): string | undefined {
  for (const key of USER_KEYS) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function loadProjectEnv(root: string): Record<string, string> {
  const file = join(root, ".env.project");
  if (!existsSync(file)) return {};
  try {
    return parseDotEnv(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function spawnText(cmd: string, args: string[]): string | undefined {
  if (!hasBinary(cmd)) return undefined;
  const result = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return undefined;
  const text = (result.stdout ?? "").trim();
  return text || undefined;
}

async function githubUserFromToken(token: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ranch-cli",
      },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { login?: string };
    return body.login?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function imageExists(image: string): boolean {
  const result = spawnSync("docker", ["image", "inspect", image], {
    stdio: "ignore",
    windowsHide: true,
  });
  return result.status === 0;
}

function loginGhcr(user: string, token: string): boolean {
  consola.start(`Logging into ghcr.io as ${user}...`);
  const result = spawnSync(
    "docker",
    ["login", "ghcr.io", "-u", user, "--password-stdin"],
    { input: token, encoding: "utf8", windowsHide: true },
  );
  if (result.status === 0) {
    consola.success("Logged into ghcr.io");
    return true;
  }
  consola.warn("docker login ghcr.io failed — will build browser-pool locally if needed.");
  return false;
}

/**
 * Make sure `ghcr.io/cleanslice/browser-pool` is on the machine before
 * compose tries to pull it. New users are not logged into GHCR, and the
 * package is private — that used to abort `ranch dev` with unauthorized.
 *
 * Fast path: image already present. Else login from GITHUB_TOKEN /
 * `.env.project` / `gh auth` and pull. If GHCR still refuses, build from
 * `k8s/browser-pool-image` and tag it with the GHCR name so compose stays
 * offline for this image.
 */
export async function ensureBrowserPoolImage(root: string): Promise<void> {
  if (imageExists(BROWSER_POOL_IMAGE)) return;

  consola.start("Preparing the private browser-pool image...");

  const fileEnv = loadProjectEnv(root);
  const token =
    pickGithubToken(process.env) ?? pickGithubToken(fileEnv) ?? spawnText("gh", ["auth", "token"]);
  let user =
    pickGithubUser(process.env) ??
    pickGithubUser(fileEnv) ??
    spawnText("gh", ["api", "user", "-q", ".login"]);
  if (token && !user) {
    user = await githubUserFromToken(token);
  }

  const loggedIn = Boolean(token && user && loginGhcr(user, token));
  if (loggedIn) {
    consola.start(`Pulling ${BROWSER_POOL_IMAGE}...`);
    const pullCode = await run("docker", ["pull", BROWSER_POOL_IMAGE]);
    if (pullCode === 0 && imageExists(BROWSER_POOL_IMAGE)) {
      consola.success("browser-pool image ready");
      return;
    }
    consola.warn("GHCR pull failed (token may lack package access). Building locally.");
  } else {
    consola.warn(
      "No GHCR credentials (GITHUB_TOKEN, .env.project, or `gh auth`). Building browser-pool locally.",
    );
  }

  const context = join(root, "k8s", "browser-pool-image");
  if (!existsSync(join(context, "Dockerfile"))) {
    consola.error(
      `Cannot pull ${BROWSER_POOL_IMAGE} and no local Dockerfile at ${context}.`,
    );
    process.exit(1);
  }

  consola.start("Building browser-pool locally (first time is slow)...");
  const buildCode = await run("docker", [
    "build",
    "--platform",
    "linux/amd64",
    "-t",
    BROWSER_POOL_IMAGE,
    context,
  ]);
  if (buildCode !== 0 || !imageExists(BROWSER_POOL_IMAGE)) {
    consola.error(
      `Failed to pull or build ${BROWSER_POOL_IMAGE}. Create a GitHub PAT with read:packages, run \`docker login ghcr.io\`, and retry.`,
    );
    process.exit(1);
  }
  consola.success("browser-pool image built locally");
}
