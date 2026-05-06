import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function isRanchProject(dir: string): boolean {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
    return pkg.name === "ranch";
  } catch {
    return false;
  }
}

export function findRanchRoot(start: string = process.cwd()): string | null {
  if (process.env.RANCH_ROOT) {
    const explicit = resolve(process.env.RANCH_ROOT);
    return isRanchProject(explicit) ? explicit : null;
  }

  let dir = resolve(start);
  while (true) {
    if (isRanchProject(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
