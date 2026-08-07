import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { consola } from "consola";

const MARKER = "# Added by ranch CLI to keep bun's global bin dir on PATH";
const NEEDLE = ".bun/bin";

function shellRcCandidates(): string[] {
  if (platform() === "win32") return [];
  const shell = process.env.SHELL || "";
  const home = homedir();
  // Login-shell file first: that's what new Terminal/IDE tabs actually
  // source on macOS, which is the file we want to end up writing to.
  if (shell.includes("zsh")) {
    return [join(home, ".zprofile"), join(home, ".zshrc")];
  }
  if (shell.includes("bash")) {
    return [join(home, ".bash_profile"), join(home, ".bashrc"), join(home, ".profile")];
  }
  // Unknown shell (fish, etc.) — don't guess at foreign syntax.
  return [];
}

function isBunGlobalBin(dir: string): boolean {
  return /[/\\]\.bun[/\\]bin$/.test(dir);
}

/**
 * `bun add -g @cleanslice/ranch` always installs into ~/.bun/bin, regardless
 * of how `bun` itself got onto this machine. But ~/.bun/bin only gets added
 * to PATH by bun's own official installer script (`curl bun.sh/install`) —
 * Homebrew's bun formula does not do this. Result: anyone with a
 * Homebrew-installed bun who follows the README's `bun add -g` quick start
 * gets `ranch` (and `bun`'s other global installs) working in the terminal
 * they installed from, then silently missing from every *new* terminal/IDE
 * tab, with no clue why.
 *
 * Since we can't fix bun's installer, self-heal here instead: the first time
 * `ranch` runs successfully, check whether the directory it was actually
 * launched from is durably persisted in the user's shell startup file, and
 * append it if not. Best-effort and silent on any failure — must never break
 * an actual command.
 */
export function ensureGlobalBinOnPath(): void {
  if (process.env.CI) return;
  try {
    const entry = process.argv[1];
    if (!entry) return;
    const binDir = resolve(dirname(entry));
    if (!isBunGlobalBin(binDir)) return;

    const candidates = shellRcCandidates();
    if (candidates.length === 0) return;

    const alreadyPersisted = candidates.some((file) => {
      if (!existsSync(file)) return false;
      try {
        return readFileSync(file, "utf8").includes(NEEDLE);
      } catch {
        return false;
      }
    });
    if (alreadyPersisted) return;

    const target = candidates.find((file) => existsSync(file)) ?? candidates[0];
    const block = `\n${MARKER}\nexport BUN_INSTALL="$HOME/.bun"\nexport PATH="$BUN_INSTALL/bin:$PATH"\n`;
    appendFileSync(target, block);

    consola.box(
      `Fixed: added ${binDir} to PATH via ${target}\n\n` +
        `bun's global installs (including this \`ranch\` CLI) live in ~/.bun/bin,\n` +
        `which is only auto-added to PATH by bun's own installer script — not by\n` +
        `Homebrew's bun. Without this, \`ranch\` and \`bun\` would keep vanishing\n` +
        `every time you open a new terminal.\n\n` +
        `Open a new terminal (or run \`source ${target}\`) to pick it up everywhere.`,
    );
  } catch {
    // best-effort — never let PATH bookkeeping break an actual command
  }
}
