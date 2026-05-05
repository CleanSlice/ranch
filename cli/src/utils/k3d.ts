import { execSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { consola } from "consola";
import { tryRun } from "./exec";

const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 2_000;

const CLUSTER = "ranch";
const KUBECONFIG_LOCAL = join(homedir(), ".kube", "ranch-local.yaml");

function hasBinary(name: string): boolean {
  try {
    execSync(`command -v ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

type ClusterState = "running" | "stopped" | "missing";

function clusterState(): ClusterState {
  try {
    const out = execSync(`k3d cluster list -o json`, {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    const list = JSON.parse(out) as Array<{ name: string; serversRunning: number; serversCount: number }>;
    const found = list.find((c) => c.name === CLUSTER);
    if (!found) return "missing";
    return found.serversRunning > 0 ? "running" : "stopped";
  } catch {
    return "missing";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function runUntilReady(cmd: string, args: string[]): Promise<"ready" | "exited" | "timeout"> {
  const child = spawn(cmd, args, { stdio: "inherit", shell: false });

  const exitPromise = new Promise<"exited">((resolve) => {
    child.on("exit", () => resolve("exited"));
    child.on("error", () => resolve("exited"));
  });

  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    if (clusterState() === "running") {
      if (child.exitCode === null) {
        try {
          child.kill("SIGTERM");
        } catch {}
      }
      return "ready";
    }
    const winner = await Promise.race([
      sleep(READY_POLL_MS).then(() => "tick" as const),
      exitPromise,
    ]);
    if (winner === "exited") {
      return clusterState() === "running" ? "ready" : "exited";
    }
  }

  if (child.exitCode === null) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
  return clusterState() === "running" ? "ready" : "timeout";
}

async function bootstrap(root: string): Promise<void> {
  mkdirSync(dirname(KUBECONFIG_LOCAL), { recursive: true });
  const kubeconfig = execSync(`k3d kubeconfig get ${CLUSTER}`).toString();
  writeFileSync(KUBECONFIG_LOCAL, kubeconfig);

  const env = { KUBECONFIG: KUBECONFIG_LOCAL };
  await tryRun("kubectl", ["create", "namespace", "platform"], { env, silent: true });
  await tryRun("kubectl", ["create", "namespace", "agents"], { env, silent: true });

  const apply = async (rel: string) => {
    const file = join(root, rel);
    if (existsSync(file)) {
      await tryRun("kubectl", ["apply", "-f", file], { env, silent: true });
    }
  };
  await apply("k8s/templates/rbac.yaml");
  await apply("k8s/templates/agent-workflow.yaml");
  await apply("k8s/local/coredns-host-alias.yaml");

  await tryRun("kubectl", ["-n", "kube-system", "rollout", "restart", "deploy", "coredns"], {
    env,
    silent: true,
  });
  await tryRun("kubectl", ["label", "node", "--all", "node-role=agents", "--overwrite"], {
    env,
    silent: true,
  });
}

export async function ensureK3dRunning(root: string): Promise<void> {
  if (!hasBinary("k3d")) {
    consola.warn("k3d not installed — skipping cluster start. Install: brew install k3d");
    return;
  }

  const state = clusterState();
  if (state === "running") {
    consola.success(`k3d cluster ${CLUSTER}: running`);
    return;
  }

  if (state === "stopped") {
    consola.start(`Starting k3d cluster ${CLUSTER}...`);
    const result = await runUntilReady("k3d", ["cluster", "start", CLUSTER]);
    if (result === "ready") {
      consola.success(`k3d cluster ${CLUSTER}: running`);
      return;
    }
    if (result === "timeout") {
      consola.warn(
        `k3d cluster start hung past ${READY_TIMEOUT_MS / 1000}s — proceeding without confirmation`
      );
      return;
    }
    consola.warn("k3d cluster start exited before cluster became ready");
    return;
  }

  consola.start(`Creating k3d cluster ${CLUSTER}...`);
  const result = await runUntilReady("k3d", [
    "cluster",
    "create",
    CLUSTER,
    "--api-port",
    "6550",
    "--wait",
  ]);
  if (result !== "ready") {
    consola.warn("k3d cluster create did not reach ready state");
    return;
  }

  if (hasBinary("kubectl")) {
    consola.start("Bootstrapping namespaces and RBAC...");
    await bootstrap(root);
  } else {
    consola.warn("kubectl not installed — skipping namespace/RBAC bootstrap.");
  }
  consola.success(`k3d cluster ${CLUSTER}: ready (kubeconfig: ${KUBECONFIG_LOCAL})`);
}
