import { defineCommand, runMain as _runMain } from "citty";
import { consola } from "consola";
import { spawn } from "node:child_process";
import { devCommand } from "./commands/dev";
import { upCommand } from "./commands/up";
import { downCommand } from "./commands/down";
import { dbCommand } from "./commands/db";
import { generateCommand } from "./commands/generate";
import { statusCommand } from "./commands/status";
import { whereCommand } from "./commands/where";
import { upgradeCommand } from "./commands/upgrade";
import {
  currentVersion,
  isCacheStale,
  readCachedCheck,
  refreshCache,
} from "./utils/version-check";

const main = defineCommand({
  meta: {
    name: "ranch",
    version: currentVersion(),
    description: "Ranch project CLI",
  },
  subCommands: {
    dev: devCommand,
    up: upCommand,
    down: downCommand,
    stop: downCommand,
    db: dbCommand,
    generate: generateCommand,
    status: statusCommand,
    where: whereCommand,
    upgrade: upgradeCommand,
  },
});

function updatesDisabled(): boolean {
  if (process.env.RANCH_NO_UPDATE_CHECK === "1") return true;
  if (process.env.CI) return true;
  return false;
}

function skipNoticeForCommand(): boolean {
  const argv = process.argv.slice(2);
  if (argv[0] === "upgrade") return true;
  return false;
}

function scheduleBackgroundCheck(): void {
  if (!isCacheStale()) return;
  const script = process.argv[1];
  if (!script) return;
  try {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, RANCH_INTERNAL_VERSION_CHECK: "1" },
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    // best-effort
  }
}

function printUpdateNotice(): void {
  const cached = readCachedCheck();
  if (!cached || !cached.hasUpdate) return;
  consola.box(
    `Ranch CLI update available: v${cached.current} → v${cached.latest}\n` +
      `Run \`ranch upgrade\` to update.`,
  );
}

export function runMain(): void {
  if (process.env.RANCH_INTERNAL_VERSION_CHECK === "1") {
    void refreshCache().finally(() => process.exit(0));
    return;
  }

  // Print a clean, parseable version and exit before citty handles it. citty
  // routes `--version` through consola, whose CI reporter (active when CI=1)
  // prefixes output with "[log] " — that breaks scripts doing
  // `ranch --version` and the publish-time stale-dist check.
  const argv = process.argv.slice(2);
  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
    console.log(currentVersion());
    process.exit(0);
  }

  if (!updatesDisabled()) scheduleBackgroundCheck();

  if (!updatesDisabled() && !skipNoticeForCommand()) {
    process.on("exit", printUpdateNotice);
  }

  _runMain(main);
}
