import { defineCommand } from "citty";
import { consola } from "consola";
import { execSync } from "node:child_process";

function portInUse(port: number): string | null {
  try {
    const out = execSync(`lsof -ti :${port}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

function dockerPs(filter: string): string {
  try {
    return execSync(`docker ps --filter "${filter}" --format "{{.Names}}"`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function k3dRunning(): boolean {
  try {
    const out = execSync(`k3d cluster list -o json`, {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    const list = JSON.parse(out) as Array<{ name: string; serversRunning: number }>;
    return list.some((c) => c.name === "ranch" && c.serversRunning > 0);
  } catch {
    return false;
  }
}

export const statusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show what's currently running locally",
  },
  async run() {
    consola.box("Ranch local status");

    const ports = [
      { port: 3000, name: "api" },
      { port: 3001, name: "app" },
      { port: 3002, name: "admin" },
    ];
    for (const { port, name } of ports) {
      const pid = portInUse(port);
      consola.log(`  ${pid ? "✔" : "·"} ${name.padEnd(8)} :${port} ${pid ? `(pid ${pid})` : "idle"}`);
    }

    const pg = dockerPs("name=postgres");
    consola.log(`  ${pg ? "✔" : "·"} postgres  ${pg || "not running"}`);

    const cluster = k3dRunning();
    consola.log(`  ${cluster ? "✔" : "·"} k3d ranch ${cluster ? "running" : "not running"}`);
  },
});
