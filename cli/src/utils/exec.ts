import { spawn, type SpawnOptions } from "node:child_process";

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdio?: SpawnOptions["stdio"];
  silent?: boolean;
}

export function run(
  cmd: string,
  args: string[] = [],
  opts: RunOptions = {}
): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: opts.stdio ?? (opts.silent ? "ignore" : "inherit"),
      shell: false,
    });
    child.on("error", rejectP);
    child.on("exit", (code) => resolveP(code ?? 0));
  });
}

export async function runOrThrow(
  cmd: string,
  args: string[] = [],
  opts: RunOptions = {}
): Promise<void> {
  const code = await run(cmd, args, opts);
  if (code !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with code ${code}`);
  }
}

export async function tryRun(
  cmd: string,
  args: string[] = [],
  opts: RunOptions = {}
): Promise<number> {
  try {
    return await run(cmd, args, opts);
  } catch {
    return 1;
  }
}
