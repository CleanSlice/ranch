import { defineCommand } from "citty";
import { consola } from "consola";
import { join } from "node:path";
import { ensureRanchRoot } from "../utils/setup";
import { tryRun } from "../utils/exec";
import { freePorts } from "../utils/ports";

export const downCommand = defineCommand({
  meta: {
    name: "down",
    description: "Stop all dev services and free ports",
  },
  async run() {
    const root = await ensureRanchRoot();

    consola.start("Freeing dev ports...");
    freePorts([3000, 3001, 3002, 3333]);

    consola.start("Stopping docker compose (api and LightRAG)...");
    await tryRun("docker", ["compose", "-f", "api/docker-compose.yml", "--profile", "rag", "down"], { cwd: root });

    consola.start("Stopping k3d cluster ranch...");
    await tryRun("k3d", ["cluster", "stop", "ranch"]);

    consola.success("All services stopped.");
  },
});
