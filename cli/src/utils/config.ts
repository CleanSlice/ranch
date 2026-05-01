import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export interface CliConfig {
  projectRoot?: string;
}

function configFile(): string {
  if (platform() === "win32") {
    const base = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(base, "ranch", "config.json");
  }
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "ranch", "config.json");
}

export function loadConfig(): CliConfig {
  const file = configFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as CliConfig;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: CliConfig): string {
  const file = configFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2));
  return file;
}

export function configPath(): string {
  return configFile();
}
