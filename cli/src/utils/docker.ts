import { execSync } from "node:child_process";
import { consola } from "consola";

function hasBinary(name: string): boolean {
  try {
    execSync(`command -v ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function ensureDockerRunning(): void {
  if (!hasBinary("docker")) {
    consola.error(
      "Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop/",
    );
    process.exit(1);
  }

  try {
    execSync("docker info", { stdio: "ignore" });
  } catch {
    consola.error("Docker daemon is not running. Start Docker Desktop and try again.");
    process.exit(1);
  }
}
