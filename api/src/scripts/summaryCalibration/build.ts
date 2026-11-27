import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Whether the build the calibration is about to run is the source as it
// stands (CLEAN-270).
//
// The calibration runs the built API (`api/dist`), like the other scripts:
// it is the code the image runs, and bun cannot load every slice of the API
// straight from its TypeScript (two barrels re-export a type as a value,
// which only a compiler that knows the types can drop). The price of running
// a build is that it can be old. The calibration exists to be rerun after
// the prompt is revised, and a prompt edited and not rebuilt would be
// measured as the old one, silently. So the entry point refuses to run on a
// build older than its source.

/**
 * The source files under `srcDir` whose built file under `distDir` is
 * missing or older, as paths relative to `srcDir`, sorted. Only what the
 * build compiles is looked at: `.ts` files that are neither specs nor
 * declarations.
 */
export function staleSources(srcDir: string, distDir: string): string[] {
  const stale: string[] = [];
  const pending: string[] = [''];
  for (let next = 0; next < pending.length; next++) {
    const folder = pending[next];
    const entries = readdirSync(join(srcDir, folder), { withFileTypes: true });
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const relative = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        pending.push(relative);
        continue;
      }
      if (
        !entry.name.endsWith('.ts') ||
        entry.name.endsWith('.spec.ts') ||
        entry.name.endsWith('.d.ts')
      ) {
        continue;
      }
      const built = join(distDir, `${relative.slice(0, -3)}.js`);
      if (
        !existsSync(built) ||
        statSync(built).mtimeMs < statSync(join(srcDir, relative)).mtimeMs
      ) {
        stale.push(relative);
      }
    }
  }
  return stale.sort();
}
