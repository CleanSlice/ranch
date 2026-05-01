import { defineCommand } from "citty";
import { consola } from "consola";
import { join } from "node:path";
import { findRanchRoot } from "../utils/root";
import { tryRun } from "../utils/exec";
import { freePorts } from "../utils/ports";

export const downCommand = defineCommand({
  meta: {
    name: "down",
    description: "Stop all dev services and free ports",
  },
  async run() {
    const root = findRanchRoot();

    consola.start("Freeing dev ports...");
    freePorts([3000, 3001, 3002, 3333]);

    consola.start("Stopping docker compose (api)...");
    await tryRun("docker", ["compose", "down"], { cwd: join(root, "api") });

    consola.start("Stopping k3d cluster ranch...");
    await tryRun("k3d", ["cluster", "stop", "ranch"]);

    consola.success("All services stopped.");
  },
});
