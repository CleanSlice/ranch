import { consola } from "consola";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig, saveConfig } from "./config";
import { runOrThrow } from "./exec";
import { findRanchRoot, isRanchProject } from "./root";

const REPO_URL = "https://github.com/CleanSlice/ranch.git";

export async function ensureRanchRoot(): Promise<string> {
  const found = findRanchRoot();
  if (found) return found;

  const cfg = loadConfig();
  if (cfg.projectRoot && isRanchProject(cfg.projectRoot)) {
    return cfg.projectRoot;
  }
  if (cfg.projectRoot) {
    consola.warn(
      `Saved project root no longer valid: ${cfg.projectRoot} — running setup again.`
    );
  }

  return interactiveSetup();
}

async function interactiveSetup(): Promise<string> {
  consola.box("Ranch project not found");
  consola.info(
    "The CLI couldn't find a Ranch project on this machine. Let's set one up."
  );

  const action = await consola.prompt("What do you want to do?", {
    type: "select",
    options: [
      { label: "Clone CleanSlice/ranch into a new directory", value: "clone" },
      { label: "Point to an existing local copy", value: "existing" },
      { label: "Cancel", value: "cancel" },
    ],
  });

  if (!action || action === "cancel" || typeof action === "symbol") {
    consola.info("Cancelled. Run any ranch command later to retry.");
    process.exit(1);
  }

  const path =
    action === "clone" ? await cloneFlow() : await existingFlow();

  const file = saveConfig({ projectRoot: path });
  consola.success(`Saved project root to ${file}`);
  consola.info(
    `From now on \`ranch\` works anywhere. Override with RANCH_ROOT or by running inside another ranch checkout.`
  );
  return path;
}

async function cloneFlow(): Promise<string> {
  const defaultDest = join(homedir(), "ranch");
  const destInput = await consola.prompt("Clone destination", {
    type: "text",
    default: defaultDest,
    placeholder: defaultDest,
  });
  const dest = resolve(String(destInput || defaultDest));

  if (existsSync(dest)) {
    if (isRanchProject(dest)) {
      consola.info(`Found existing Ranch project at ${dest} — reusing it.`);
      return dest;
    }
    consola.error(
      `Destination already exists and is not a Ranch project: ${dest}`
    );
    process.exit(1);
  }

  consola.start(`Cloning ${REPO_URL} → ${dest}`);
  await runOrThrow("git", ["clone", REPO_URL, dest]);

  const installDeps = await consola.prompt("Run `bun install` now?", {
    type: "confirm",
    initial: true,
  });
  if (installDeps) {
    consola.start("Installing dependencies (this can take a minute)...");
    await runOrThrow("bun", ["install"], { cwd: dest });
  } else {
    consola.warn("Skipped dependency install — run `bun install` before `ranch dev`.");
  }

  return dest;
}

async function existingFlow(): Promise<string> {
  const input = await consola.prompt("Path to existing ranch checkout", {
    type: "text",
  });
  const path = resolve(String(input || ""));
  if (!isRanchProject(path)) {
    consola.error(
      `Not a Ranch project: ${path}\n` +
        `Expected a directory whose package.json has \`"name": "ranch"\`.`
    );
    process.exit(1);
  }
  return path;
}
