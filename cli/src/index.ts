import { defineCommand, runMain as _runMain } from "citty";
import pkg from "../package.json" with { type: "json" };
import { devCommand } from "./commands/dev";
import { downCommand } from "./commands/down";
import { dbCommand } from "./commands/db";
import { generateCommand } from "./commands/generate";
import { statusCommand } from "./commands/status";
import { whereCommand } from "./commands/where";

const main = defineCommand({
  meta: {
    name: "ranch",
    version: pkg.version,
    description: "Ranch project CLI",
  },
  subCommands: {
    dev: devCommand,
    down: downCommand,
    stop: downCommand,
    db: dbCommand,
    generate: generateCommand,
    status: statusCommand,
    where: whereCommand,
  },
});

export function runMain(): void {
  _runMain(main);
}
