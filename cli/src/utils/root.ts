import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function findRanchRoot(start: string = process.cwd()): string {
  if (process.env.RANCH_ROOT) return resolve(process.env.RANCH_ROOT);

  let dir = resolve(start);
  while (true) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg.name === "ranch") return dir;
      } catch {}
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        "Could not find Ranch project root. Run from inside the ranch/ directory or set RANCH_ROOT."
      );
    }
    dir = parent;
  }
}
