import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

function candidateNames(name: string): string[] {
  if (process.platform !== "win32") return [name];
  const names = new Set([name]);
  const exts = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean);
  const lower = name.toLowerCase();
  const hasExt = exts.some((ext) => lower.endsWith(ext.toLowerCase()));
  if (!hasExt) {
    for (const ext of exts) names.add(name + ext);
  }
  return [...names];
}

/**
 * True if `name` is on PATH.
 *
 * Node's `execSync` uses cmd.exe on Windows, so a Unix `command -v` check
 * always fails there even when Docker Desktop is installed and running.
 */
export function hasBinary(name: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  if (!pathEnv) return false;
  const names = candidateNames(name);
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const candidate of names) {
      if (existsSync(join(dir, candidate))) return true;
    }
  }
  return false;
}
