import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { consola } from "consola";
import { runOrThrow } from "./exec";

const STAMP = "node_modules/.ranch-deps-stamp";

function readWorkspaces(root: string): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      workspaces?: string[];
    };
    return pkg.workspaces ?? [];
  } catch {
    return [];
  }
}

function mtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function manifestNewest(root: string, workspaces: string[]): number {
  const files = [
    join(root, "package.json"),
    join(root, "bun.lock"),
    join(root, "bun.lockb"),
    ...workspaces.map((w) => join(root, w, "package.json")),
  ];
  return files.reduce((max, f) => Math.max(max, mtime(f)), 0);
}

function stampOldest(root: string, workspaces: string[]): number {
  const dirs = [root, ...workspaces.map((w) => join(root, w))];
  let oldest = Infinity;
  for (const dir of dirs) {
    const nm = join(dir, "node_modules");
    if (!existsSync(nm)) return 0;
    const stamp = join(dir, STAMP);
    if (!existsSync(stamp)) return 0;
    oldest = Math.min(oldest, mtime(stamp));
  }
  return oldest === Infinity ? 0 : oldest;
}

function writeStamps(root: string, workspaces: string[]): void {
  const now = new Date();
  const dirs = [root, ...workspaces.map((w) => join(root, w))];
  for (const dir of dirs) {
    const nm = join(dir, "node_modules");
    if (!existsSync(nm)) continue;
    const stamp = join(dir, STAMP);
    try {
      writeFileSync(stamp, "");
      utimesSync(stamp, now, now);
    } catch {}
  }
}

export async function ensureDepsInstalled(root: string): Promise<void> {
  const workspaces = readWorkspaces(root);
  const newest = manifestNewest(root, workspaces);
  const oldest = stampOldest(root, workspaces);

  if (oldest > 0 && oldest >= newest) return;

  if (oldest === 0) {
    consola.start("Installing dependencies (first run)...");
  } else {
    consola.start("Dependencies changed — running bun install...");
  }
  try {
    await runOrThrow("bun", ["install"], { cwd: root });
    writeStamps(root, workspaces);
    consola.success("Dependencies up to date.");
  } catch (err) {
    consola.warn(`bun install failed: ${(err as Error).message}`);
  }
}
