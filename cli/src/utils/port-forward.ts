import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { consola } from "consola";

const KUBECONFIG_LOCAL = join(homedir(), ".kube", "ranch-local.yaml");

function portInUse(port: number): boolean {
  try {
    execSync(`lsof -ti :${port}`, { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function hasBinary(name: string): boolean {
  try {
    execSync(`command -v ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface PortForwardSpec {
  label: string;
  namespace: string;
  service: string;
  port: number;
}

export function ensurePortForwards(specs: PortForwardSpec[]): void {
  if (!hasBinary("kubectl")) {
    consola.warn("kubectl not installed — skipping port-forwards");
    return;
  }
  if (!existsSync(KUBECONFIG_LOCAL)) {
    consola.warn(`Kubeconfig not found at ${KUBECONFIG_LOCAL} — skipping port-forwards`);
    return;
  }

  const children: ChildProcess[] = [];

  for (const spec of specs) {
    if (portInUse(spec.port)) {
      consola.info(`${spec.label}: localhost:${spec.port} already bound — skipping forward`);
      continue;
    }
    consola.start(`Forwarding ${spec.label} → localhost:${spec.port}`);
    const child = spawn(
      "kubectl",
      [
        "port-forward",
        "-n",
        spec.namespace,
        `svc/${spec.service}`,
        `${spec.port}:${spec.port}`,
      ],
      {
        env: { ...process.env, KUBECONFIG: KUBECONFIG_LOCAL },
        stdio: "ignore",
        detached: false,
      },
    );
    child.on("exit", (code, signal) => {
      if (signal === "SIGTERM" || signal === "SIGINT") return;
      if (code !== null && code !== 0) {
        consola.warn(`${spec.label} port-forward exited with code ${code}`);
      }
    });
    children.push(child);
  }

  if (children.length === 0) return;

  const cleanup = () => {
    for (const child of children) {
      if (child.exitCode === null) {
        try {
          child.kill("SIGTERM");
        } catch {}
      }
    }
  };
  process.once("exit", cleanup);
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
}
