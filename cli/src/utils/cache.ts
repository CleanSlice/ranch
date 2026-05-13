import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

function cacheDir(): string {
  if (platform() === "win32") {
    const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return join(base, "ranch", "cache");
  }
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "ranch");
}

export function cacheFile(name: string): string {
  return join(cacheDir(), name);
}

export function readCache<T>(name: string): T | null {
  const file = cacheFile(name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeCache<T>(name: string, data: T): void {
  const file = cacheFile(name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}
