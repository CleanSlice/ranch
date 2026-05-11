import { defineCommand } from "citty";
import { consola } from "consola";
import {
  compareSemver,
  currentVersion,
  refreshCache,
} from "../utils/version-check";
import { applyUpgrade, detectPackageManager } from "../utils/upgrade";

export const upgradeCommand = defineCommand({
  meta: {
    name: "upgrade",
    description: "Update Ranch CLI to the latest version from GitHub",
  },
  args: {
    check: {
      type: "boolean",
      description: "Only check, do not install",
      default: false,
    },
  },
  async run({ args }) {
    const current = currentVersion();
    consola.start(`Checking latest version on GitHub (current: v${current})`);
    const result = await refreshCache();
    if (!result) {
      consola.warn("Could not reach GitHub. Try again later.");
      process.exit(1);
    }
    const cmp = compareSemver(result.latest, current);
    if (cmp <= 0) {
      consola.success(`You are on the latest version (v${current}).`);
      return;
    }
    consola.info(`New version available: v${current} → v${result.latest}`);
    if (args.check) return;
    const pm = detectPackageManager();
    consola.start(`Installing v${result.latest} via ${pm}`);
    const code = await applyUpgrade(result.latest);
    if (code === 0) {
      consola.success(`Upgraded to v${result.latest}. Run \`ranch --version\` to confirm.`);
    } else {
      consola.error(`Upgrade command exited with code ${code}.`);
      process.exit(code);
    }
  },
});
