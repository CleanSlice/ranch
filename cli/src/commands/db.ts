import { defineCommand } from "citty";
import { consola } from "consola";
import { join } from "node:path";
import { findRanchRoot } from "../utils/root";
import { runOrThrow, tryRun } from "../utils/exec";

export const dbCommand = defineCommand({
  meta: {
    name: "db",
    description: "Manage local Postgres (start | stop | reset | studio)",
  },
  args: {
    action: {
      type: "positional",
      required: true,
      description: "start | stop | reset | studio",
    },
  },
  async run({ args }) {
    const root = findRanchRoot();
    const apiDir = join(root, "api");

    switch (args.action) {
      case "start": {
        consola.start("Starting Postgres...");
        await runOrThrow("docker", ["compose", "up", "-d"], { cwd: apiDir });
        consola.success("Postgres is up.");
        break;
      }
      case "stop": {
        consola.start("Stopping Postgres...");
        await tryRun("docker", ["compose", "down"], { cwd: apiDir });
        consola.success("Postgres stopped.");
        break;
      }
      case "reset": {
        consola.warn("Resetting Postgres (data will be destroyed)...");
        await runOrThrow("docker", ["compose", "down", "-v"], { cwd: apiDir });
        consola.success("Postgres reset.");
        break;
      }
      case "studio": {
        consola.start("Opening Prisma Studio...");
        await runOrThrow("bun", ["run", "studio"], { cwd: apiDir });
        break;
      }
      default:
        consola.error(`Unknown action: ${args.action}. Use start | stop | reset | studio.`);
        process.exit(1);
    }
  },
});
