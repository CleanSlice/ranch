import { defineCommand } from "citty";
import { consola } from "consola";
import { configPath, loadConfig } from "../utils/config";
import { findRanchRoot, isRanchProject } from "../utils/root";

export const whereCommand = defineCommand({
  meta: {
    name: "where",
    description: "Show which Ranch project root the CLI is using and where its config lives",
  },
  async run() {
    const env = process.env.RANCH_ROOT;
    const fromCwd = findRanchRoot();
    const cfg = loadConfig();

    consola.box("Ranch root resolution");
    consola.log(`  RANCH_ROOT env  ${env ? env : "(unset)"}`);
    consola.log(`  walked from cwd ${fromCwd ?? "(not found)"}`);
    consola.log(
      `  cached path     ${
        cfg.projectRoot
          ? `${cfg.projectRoot}${isRanchProject(cfg.projectRoot) ? "" : "  ⚠ no longer valid"}`
          : "(not set)"
      }`
    );
    consola.log(`  config file     ${configPath()}`);
    consola.log("");
    const winner = env || fromCwd || cfg.projectRoot;
    if (winner && isRanchProject(winner)) {
      consola.success(`Active project root: ${winner}`);
    } else {
      consola.warn("No project root resolved yet — next command will run setup.");
    }
  },
});
