import { defineCommand } from "citty";
import { devCommand } from "./dev";

/**
 * `ranch up` — like `ranch dev`, but skips the pre-flight test run. For
 * the "just get me a running stack" case; use `ranch dev` when you want
 * tests to gate the boot.
 */
export const upCommand = defineCommand({
  meta: {
    name: "up",
    description: "Start dev servers without running tests first",
  },
  args: {
    target: {
      type: "positional",
      required: false,
      description: "Optional: api | app | admin",
    },
    "no-k3d": {
      type: "boolean",
      description: "Skip k3d cluster start",
    },
    "no-install": {
      type: "boolean",
      description: "Skip dependency freshness check",
    },
  },
  async run({ args }) {
    // Single source of truth: defer to `dev` with --no-test forced on. If
    // dev grows new flags later, only the type signature here needs the
    // matching entry; the runtime behaviour is inherited automatically.
    await devCommand.run!({
      args: { ...args, "no-test": true },
      // citty's RunContext is broader than just `args`; the dev command
      // doesn't touch the rest, so an empty shape is enough at runtime.
    } as Parameters<NonNullable<typeof devCommand.run>>[0]);
  },
});
