import { execSync } from "node:child_process";
import { consola } from "consola";
import { hasBinary } from "./bin";

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
