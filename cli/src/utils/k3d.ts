import { execSync, spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { consola } from "consola";
import { hasBinary } from "./bin";
import { tryRun } from "./exec";

const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 2_000;

const CLUSTER = "ranch";
export const K3D_NETWORK = "k3d-ranch";
const KUBECONFIG_LOCAL = join(homedir(), ".kube", "ranch-local.yaml");

export function k3dInstallHint(platform = process.platform): string {
  if (platform === "win32") {
    return "winget install -e --id k3d.k3d\n   or: choco install k3d\n   or: scoop install k3d";
  }
  if (platform === "darwin") {
    return "brew install k3d";
  }
  return "curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash";
}

export function ensureK3dInstalled(): void {
  if (hasBinary("k3d")) return;
  consola.error(
    `k3d is not installed. compose needs the ${K3D_NETWORK} docker network that k3d creates — install it before ranch pulls any images.\n\nInstall:\n  ${k3dInstallHint()}\n\nThen re-run \`ranch dev\` (it creates the cluster).`,
  );
  process.exit(1);
}

export function k3dNetworkExists(): boolean {
  const result = spawnSync("docker", ["network", "inspect", K3D_NETWORK], {
    stdio: "ignore",
    windowsHide: true,
  });
  return result.status === 0;
}

export function ensureK3dNetwork(opts: { createIfMissing?: boolean } = {}): void {
  if (k3dNetworkExists()) return;
  if (opts.createIfMissing) {
    consola.start(`Creating docker network ${K3D_NETWORK}...`);
    const created = spawnSync("docker", ["network", "create", K3D_NETWORK], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (created.status === 0 && k3dNetworkExists()) {
      consola.success(`Created ${K3D_NETWORK} (no k3d cluster)`);
      return;
    }
  }
  consola.error(
    `Docker network ${K3D_NETWORK} is missing. Install k3d and re-run \`ranch dev\`, or pass --no-k3d to create a dummy network.\n\nInstall:\n  ${k3dInstallHint()}`,
  );
  process.exit(1);
}

type ClusterState = "running" | "stopped" | "missing";

function clusterState(): ClusterState {
  try {
    const out = execSync(`k3d cluster list -o json`, {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    const list = JSON.parse(out) as Array<{
      name: string;
      serversRunning: number;
      serversCount: number;
    }>;
    const found = list.find((c) => c.name === CLUSTER);
    if (!found) return "missing";
    if (found.serversRunning === 0) return "stopped";
    if (!allNodesRunning()) return "stopped";
    return "running";
  } catch {
    return "missing";
  }
}

function allNodesRunning(): boolean {
  try {
    const out = execSync(
      `docker ps -a --filter "label=k3d.cluster=${CLUSTER}" --format "{{.State}}|{{.Label \\"k3d.role\\"}}"`,
      { stdio: ["ignore", "pipe", "ignore"] },
    ).toString();
    const nodes = out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [state, role] = line.split("|");
        return { state, role };
      });
    const runtimeRoles = new Set(["server", "agent", "loadbalancer"]);
    const runtimeNodes = nodes.filter((n) => n.role && runtimeRoles.has(n.role));
    if (runtimeNodes.length === 0) return false;
    return runtimeNodes.every((n) => n.state === "running");
  } catch {
    return false;
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
  ensureK3dInstalled();

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
