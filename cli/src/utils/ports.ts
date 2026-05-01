import { execSync } from "node:child_process";
import { consola } from "consola";

export function freePorts(ports: number[]): void {
  for (const port of ports) {
    try {
      const out = execSync(`lsof -ti :${port}`, { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
      if (!out) continue;
      const pids = out.split("\n").filter(Boolean);
      for (const pid of pids) {
        consola.info(`Killing process on port ${port} (PID ${pid})`);
        try {
          execSync(`kill -9 ${pid}`, { stdio: "ignore" });
        } catch {}
      }
    } catch {}
  }
}
