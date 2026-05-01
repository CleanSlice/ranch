import { defineCommand } from "citty";
import { consola } from "consola";
import { findRanchRoot } from "../utils/root";
import { run } from "../utils/exec";
import { freePorts } from "../utils/ports";

export const devCommand = defineCommand({
  meta: {
    name: "dev",
    description: "Start dev servers (api + app + admin, or one of them)",
  },
  args: {
    target: {
      type: "positional",
      required: false,
      description: "Optional: api | app | admin",
    },
  },
  async run({ args }) {
    const root = findRanchRoot();
    freePorts([3000, 3001, 3002]);

    const target = args.target;
    const turboArgs = ["run", "turbo", "dev"];
    if (target) {
      if (!["api", "app", "admin"].includes(target)) {
        consola.error(`Unknown target: ${target}. Use api | app | admin.`);
        process.exit(1);
      }
      turboArgs.push(`--filter=${target}`);
      consola.start(`Starting ${target} (dev)...`);
    } else {
      consola.start("Starting api + app + admin (dev)...");
    }

    const code = await run("bun", turboArgs, { cwd: root });
    process.exit(code);
  },
});
