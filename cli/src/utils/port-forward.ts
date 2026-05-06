import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { consola } from "consola";

const KUBECONFIG_LOCAL = join(homedir(), ".kube", "ranch-local.yaml");
const RESTART_DELAY_MS = 3_000;
const MAX_RESTARTS = 20;

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

interface ManagedPortForward {
  spec: PortForwardSpec;
  child: ChildProcess | null;
  restarts: number;
  stopped: boolean;
}

function spawnKubectl(spec: PortForwardSpec): ChildProcess {
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
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    },
  );
  let stderrBuf = "";
  child.stderr?.on("data", (chunk) => {
    stderrBuf += chunk.toString();
    if (stderrBuf.length > 4000) stderrBuf = stderrBuf.slice(-4000);
  });
  (child as ChildProcess & { _stderrBuf: () => string })._stderrBuf = () => stderrBuf;
  return child;
}

function startManaged(mpf: ManagedPortForward): void {
  if (mpf.stopped) return;
  if (portInUse(mpf.spec.port)) {
    consola.info(
      `${mpf.spec.label}: localhost:${mpf.spec.port} already bound — skipping forward`,
    );
    return;
  }

  consola.start(`Forwarding ${mpf.spec.label} → localhost:${mpf.spec.port}`);
  const child = spawnKubectl(mpf.spec);
  mpf.child = child;

  child.on("exit", (code, signal) => {
    if (mpf.stopped) return;
    if (signal === "SIGTERM" || signal === "SIGINT") return;

    const stderr = (child as ChildProcess & { _stderrBuf?: () => string })._stderrBuf?.() ?? "";
    const reason = stderr.trim().split("\n").slice(-3).join(" | ") || `exit ${code}`;

    if (mpf.restarts >= MAX_RESTARTS) {
      consola.error(
        `${mpf.spec.label} port-forward gave up after ${MAX_RESTARTS} restarts. Last error: ${reason}`,
      );
      return;
    }
    mpf.restarts += 1;
    consola.warn(
      `${mpf.spec.label} port-forward died (${reason}). Restart ${mpf.restarts}/${MAX_RESTARTS} in ${RESTART_DELAY_MS / 1000}s.`,
    );
    setTimeout(() => startManaged(mpf), RESTART_DELAY_MS);
  });
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

  const managed: ManagedPortForward[] = specs.map((spec) => ({
    spec,
    child: null,
    restarts: 0,
    stopped: false,
  }));

  for (const mpf of managed) {
    startManaged(mpf);
  }

  const cleanup = () => {
    for (const mpf of managed) {
      mpf.stopped = true;
      if (mpf.child && mpf.child.exitCode === null) {
        try {
          mpf.child.kill("SIGTERM");
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
