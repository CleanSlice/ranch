import { execSync } from "node:child_process";
import { run } from "./exec";

const PACKAGE = "@cleanslice/ranch";

export type PackageManager = "bun" | "npm";

export function detectPackageManager(): PackageManager {
  const argv1 = process.argv[1] ?? "";
  if (argv1.includes("/.bun/") || argv1.includes("\\.bun\\")) return "bun";
  if (process.env.BUN_INSTALL && argv1.startsWith(process.env.BUN_INSTALL)) return "bun";
  try {
    execSync("bun --version", { stdio: "ignore" });
    if (argv1.includes("bun")) return "bun";
  } catch {
    // bun not installed
  }
  return "npm";
}

export async function applyUpgrade(version: string): Promise<number> {
  const pm = detectPackageManager();
  const spec = `${PACKAGE}@${version}`;
  if (pm === "bun") {
    return run("bun", ["add", "-g", spec]);
  }
  return run("npm", ["install", "-g", spec]);
}
