import { defineCommand } from "citty";
import { consola } from "consola";
import { join } from "node:path";
import { ensureRanchRoot } from "../utils/setup";
import { runOrThrow } from "../utils/exec";

export const generateCommand = defineCommand({
  meta: {
    name: "generate",
    description: "Regenerate Prisma schema from slices and run prisma generate",
  },
  async run() {
    const root = await ensureRanchRoot();
    const apiDir = join(root, "api");

    consola.start("Generating Prisma schema from slices...");
    await runOrThrow("bun", ["run", "generate"], { cwd: apiDir });
    consola.success("Prisma artifacts generated.");
  },
});
