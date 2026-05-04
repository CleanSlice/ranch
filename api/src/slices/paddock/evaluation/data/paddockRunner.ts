import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import {
  IPaddockRunner,
  IPaddockRunnerInput,
  IPaddockRunnerOutput,
} from '../domain/paddockRunner';
import {
  IPaddockScenarioData,
  PaddockEvalDimension,
} from '../../scenario/domain';

type PaddockJsonReport = {
  passRate?: number;
  results?: Array<{
    id: string;
    verdict: 'pass' | 'fail' | 'partial' | 'skipped';
    score: number;
    agreement: number;
    dimensions?: Partial<Record<PaddockEvalDimension, number>>;
    failureReasons?: string[];
    judges?: Array<{
      model: string;
      score: number;
      verdict: 'pass' | 'fail' | 'partial' | 'skipped';
      reasoning?: Partial<Record<PaddockEvalDimension, string>>;
    }>;
  }>;
  errors?: Array<{ scenario: string; phase: string; message: string }>;
};

/**
 * Runs paddock by spawning the paddock CLI under Bun. We can't use the library
 * in-process because paddock dynamic-imports `runtime/src/runtime.ts`, and Node
 * (ts-node, under nest start) can't load `.ts` files from outside its tsconfig
 * include paths. Bun handles this natively, so we shell out.
 */
@Injectable()
export class BunCliPaddockRunner extends IPaddockRunner {
  private readonly logger = new Logger(BunCliPaddockRunner.name);
  private active = new Map<string, ChildProcess>();
  // Per-agent ring buffer of paddock CLI stdout+stderr lines. Cleared
  // when a fresh run starts for the same agentId. Cap keeps memory bounded
  // for long evals (~2000 lines × ~200 chars ≈ 400KB max per agent).
  private logs = new Map<string, string[]>();
  private readonly LOG_BUFFER_MAX = 2000;

  getLogs(agentId: string): string[] {
    return this.logs.get(agentId) ?? [];
  }

  private appendLog(agentId: string, line: string): void {
    let buf = this.logs.get(agentId);
    if (!buf) {
      buf = [];
      this.logs.set(agentId, buf);
    }
    buf.push(line);
    if (buf.length > this.LOG_BUFFER_MAX) {
      buf.splice(0, buf.length - this.LOG_BUFFER_MAX);
    }
  }

  abort(agentId: string): boolean {
    const proc = this.active.get(agentId);
    if (!proc) return false;
    this.logger.log(
      `Aborting paddock CLI for agent ${agentId} (pid=${proc.pid})`,
    );
    try {
      proc.kill('SIGTERM');
    } catch {
      // best-effort
    }
    setTimeout(() => {
      try {
        if (!proc.killed) proc.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, 2000);
    return true;
  }

  async run(input: IPaddockRunnerInput): Promise<IPaddockRunnerOutput> {
    const runtimeRoot = this.resolveRuntimeRoot();
    if (!runtimeRoot) {
      throw new BadRequestException(
        'Runtime root not found. Set PADDOCK_RUNTIME_ROOT in .env to the runtime monorepo path.',
      );
    }

    const cliPath = this.resolvePaddockCli();
    if (!cliPath) {
      throw new InternalServerErrorException(
        'Cannot resolve @cleanslice/paddock CLI binary. Reinstall the package.',
      );
    }

    if (input.judges.length === 0) {
      throw new BadRequestException(
        'No usable judge credentials — at least one Anthropic, OpenAI, or Google credential must be configured.',
      );
    }

    // Materialize scenarios as YAML inside a temp namespace under
    // <runtimeRoot>/.paddock/scenarios/_ranch_<id>/. Paddock loads scenarios
    // from this directory tree, so we put ours there and clean up afterward.
    const namespace = `_ranch_${input.agentId}_${Date.now()}`;
    const scenariosRoot = join(runtimeRoot, '.paddock', 'scenarios');
    const scenariosDir = join(scenariosRoot, namespace);

    // Sweep stale namespaces from previous aborted/crashed runs. Paddock loads
    // scenarios recursively and does NOT dedupe by id, so a leftover yaml with
    // the same id makes paddock run our scenario multiple times.
    await this.sweepStaleNamespaces(scenariosRoot, input.agentId);

    await mkdir(scenariosDir, { recursive: true });

    const reportsDir = join(runtimeRoot, '.paddock', 'reports');
    mkdirSync(reportsDir, { recursive: true });

    const startTs = Date.now();
    let stderrAcc = '';
    let stdoutAcc = '';

    try {
      // Prefix YAML filenames with a zero-padded index so paddock's
      // readdirSync (which has no guaranteed sort) iterates them in the
      // same order the API queued them. This keeps the eval execution
      // order aligned with the order the UI renders, so "scenarios
      // before current = done" is a valid derivation.
      const pad = String(input.scenarios.length).length;
      for (let i = 0; i < input.scenarios.length; i++) {
        const s = input.scenarios[i];
        const idx = String(i + 1).padStart(pad, '0');
        await writeFile(
          join(scenariosDir, `${idx}-${s.id}.yaml`),
          scenarioToYaml(s),
          'utf-8',
        );
      }

      const env = this.buildEnv(input);
      const args = [
        cliPath,
        'run',
        '--repo',
        runtimeRoot,
        '--agent-dir',
        input.agentDir,
        '--scenarios',
        input.scenarios.map((s) => s.id).join(','),
        '--threshold',
        String(input.config.threshold),
        '--full',
      ];

      this.logger.log(
        `Spawning bun ${cliPath} run for ${input.scenarios.length} scenarios in ${runtimeRoot}`,
      );
      this.logger.log(
        `[order] ${input.scenarios
          .map((s, i) => `${i + 1}.${s.category}/${s.difficulty}/${s.name}`)
          .join(' → ')}`,
      );

      const onProgress = input.onProgress;
      const progressRegex = /\[paddock\] running scenario (\d+)\/(\d+): (\S+)/;
      const completionRegex = /\[paddock\] scenario (\S+):/;
      const tag = `[paddock cli] ${input.agentId}`;

      // Fresh run for this agent — wipe the previous in-memory log buffer.
      this.logs.set(input.agentId, []);

      // Watchdog: paddock CLI prints `[paddock] running scenario N/M: id` when
      // a scenario starts and `[paddock] scenario id: OK|N errors` when it
      // ends. If neither line appears for STUCK_THRESHOLD_MS, kill the
      // subprocess — a hung LLM call inside a single scenario would otherwise
      // burn the full eval budget (maxTimeMs = 30 min default).
      const STUCK_THRESHOLD_MS = parseInt(
        process.env.PADDOCK_SCENARIO_STUCK_MS ?? '300000', // 5 min
        10,
      );
      const WATCHDOG_TICK_MS = 30_000;
      let lastProgressTs = Date.now();
      let stuckScenarioId: string | null = null;
      let watchdogKilled = false;

      const exitCode = await new Promise<number>((resolveProc, reject) => {
        const proc = spawn('bun', args, {
          env,
          cwd: runtimeRoot,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.active.set(input.agentId, proc);

        const watchdog = setInterval(() => {
          const idle = Date.now() - lastProgressTs;
          if (idle <= STUCK_THRESHOLD_MS) return;
          watchdogKilled = true;
          const msg = `Watchdog: scenario ${stuckScenarioId ?? '<unknown>'} stuck for ${Math.round(idle / 1000)}s — killing paddock CLI`;
          this.logger.warn(`${tag} ${msg}`);
          this.appendLog(input.agentId, `[watchdog] ${msg}`);
          try {
            proc.kill('SIGTERM');
          } catch {
            // best-effort
          }
          setTimeout(() => {
            try {
              if (!proc.killed) proc.kill('SIGKILL');
            } catch {
              // ignore
            }
          }, 2000);
          clearInterval(watchdog);
        }, WATCHDOG_TICK_MS);

        let outBuf = '';
        let errBuf = '';
        proc.stdout?.on('data', (d) => {
          const chunk = String(d);
          stdoutAcc += chunk;
          outBuf += chunk;
          let nlIdx: number;
          while ((nlIdx = outBuf.indexOf('\n')) >= 0) {
            const line = outBuf.slice(0, nlIdx);
            outBuf = outBuf.slice(nlIdx + 1);
            if (line.length > 0) {
              this.logger.log(`${tag} ${line}`);
              this.appendLog(input.agentId, line);
            }
            // Reset watchdog on either start-of-scenario OR completion-of-scenario.
            const startMatch = progressRegex.exec(line);
            if (startMatch) {
              lastProgressTs = Date.now();
              stuckScenarioId = startMatch[3];
              if (onProgress) {
                try {
                  const event = {
                    index: parseInt(startMatch[1], 10),
                    total: parseInt(startMatch[2], 10),
                    scenarioId: startMatch[3],
                  };
                  Promise.resolve(onProgress(event)).catch(() => undefined);
                } catch {
                  // ignore — progress is best-effort
                }
              }
            } else if (completionRegex.test(line)) {
              lastProgressTs = Date.now();
            }
          }
        });
        proc.stderr?.on('data', (d) => {
          const chunk = String(d);
          stderrAcc += chunk;
          errBuf += chunk;
          let nlIdx: number;
          while ((nlIdx = errBuf.indexOf('\n')) >= 0) {
            const line = errBuf.slice(0, nlIdx);
            errBuf = errBuf.slice(nlIdx + 1);
            if (line.length > 0) {
              this.logger.warn(`${tag} ${line}`);
              this.appendLog(input.agentId, `[stderr] ${line}`);
            }
          }
        });
        proc.on('error', (err) => {
          clearInterval(watchdog);
          this.active.delete(input.agentId);
          reject(err);
        });
        proc.on('close', (code) => {
          clearInterval(watchdog);
          this.active.delete(input.agentId);
          resolveProc(code ?? 0);
        });
      });

      this.logger.log(
        `paddock CLI exited with ${exitCode} (non-zero is OK if eval failed legitimately)`,
      );

      const wantedIds = new Set(input.scenarios.map((s) => s.id));
      const reportFiles = await this.findReportSince(
        reportsDir,
        startTs,
        wantedIds,
      );
      if (!reportFiles) {
        if (watchdogKilled) {
          throw new InternalServerErrorException(
            `Watchdog killed paddock CLI: scenario "${stuckScenarioId ?? '<unknown>'}" was idle for >${Math.round(STUCK_THRESHOLD_MS / 1000)}s with no progress (override with PADDOCK_SCENARIO_STUCK_MS env, in ms).`,
          );
        }
        const tail = (stderrAcc || stdoutAcc).slice(-1500);
        throw new InternalServerErrorException(
          `paddock CLI produced no report for scenarios [${[...wantedIds].join(', ')}]. Last output:\n${tail}`,
        );
      }

      const reportJsonText = await readFile(reportFiles.json, 'utf-8');
      const reportJson = JSON.parse(reportJsonText) as PaddockJsonReport;
      const reportMd = await readFile(reportFiles.md, 'utf-8');

      return this.mapOutput(input, reportJson, reportMd, stderrAcc);
    } finally {
      try {
        await rm(scenariosDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }

  private resolveRuntimeRoot(): string | null {
    const fromEnv = process.env.PADDOCK_RUNTIME_ROOT;
    if (fromEnv && this.isRuntimeRoot(fromEnv)) {
      return resolve(fromEnv);
    }
    const candidates = [
      resolve(process.cwd(), '../../runtime'),
      resolve(process.cwd(), '../runtime'),
      resolve(process.cwd(), 'runtime'),
    ];
    for (const candidate of candidates) {
      if (this.isRuntimeRoot(candidate)) {
        this.logger.log(`Auto-detected runtime root at ${candidate}`);
        return candidate;
      }
    }
    return null;
  }

  private isRuntimeRoot(path: string): boolean {
    return existsSync(resolve(path, 'src/runtime.ts'));
  }

  private resolvePaddockCli(): string | null {
    try {
      // package.json declares "./cli" as an export
      return require.resolve('@cleanslice/paddock/cli');
    } catch {
      try {
        return require.resolve('@cleanslice/paddock/dist/cli.js');
      } catch {
        return null;
      }
    }
  }

  private buildEnv(input: IPaddockRunnerInput): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') env[k] = v;
    }

    // Judge credentials → EVAL_*_JUDGE_MODEL + provider keys
    for (const j of input.judges) {
      const provider = j.provider.toLowerCase();
      if (provider === 'claude' || provider === 'anthropic') {
        if (!env.CLAUDE_CODE_OAUTH_TOKEN)
          env.CLAUDE_CODE_OAUTH_TOKEN = j.apiKey;
        if (!env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = j.apiKey;
        if (!env.EVAL_CLAUDE_JUDGE_MODEL && j.model)
          env.EVAL_CLAUDE_JUDGE_MODEL = j.model;
      } else if (provider === 'openai') {
        if (!env.OPENAI_API_KEY) env.OPENAI_API_KEY = j.apiKey;
        if (!env.EVAL_OPENAI_JUDGE_MODEL && j.model)
          env.EVAL_OPENAI_JUDGE_MODEL = j.model;
      } else if (provider === 'gemini' || provider === 'google') {
        if (!env.GEMINI_API_KEY) env.GEMINI_API_KEY = j.apiKey;
        if (!env.EVAL_GEMINI_JUDGE_MODEL && j.model)
          env.EVAL_GEMINI_JUDGE_MODEL = j.model;
      }
    }

    // Agent's own LLM credential → EVAL_LLM_MODEL (overrides paddock's
    // hardcoded "claude-sonnet-4-6" default in agent-runner.ts).
    // OVERWRITES any judge-set Claude key so the agent uses its own credential
    // instead of accidentally sharing rate-limit budget with the judges.
    if (input.agentLlm) {
      const agentProvider = input.agentLlm.provider.toLowerCase();
      if (input.agentLlm.model) env.EVAL_LLM_MODEL = input.agentLlm.model;
      if (agentProvider === 'claude' || agentProvider === 'anthropic') {
        env.CLAUDE_CODE_OAUTH_TOKEN = input.agentLlm.apiKey;
        env.ANTHROPIC_API_KEY = input.agentLlm.apiKey;
      } else if (agentProvider === 'openai') {
        env.OPENAI_API_KEY = input.agentLlm.apiKey;
      } else if (agentProvider === 'gemini' || agentProvider === 'google') {
        env.GEMINI_API_KEY = input.agentLlm.apiKey;
      }
    }

    // Eval messages always come from "eval-user" (paddock's MockChannel default).
    // Runtime gates `adminOnly` tools (memory_save/memory_search, secret_*,
    // skill mgmt, etc.) on AccessService.isAdmin(userId) — without this, the
    // eval user is non-admin and the agent literally cannot see those tools.
    // Merge with whatever was already set so a real Telegram admin list is
    // preserved if the operator configured one.
    const existingAdmins = (env.TELEGRAM_BOT_ADMIN_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!existingAdmins.includes('eval-user')) {
      env.TELEGRAM_BOT_ADMIN_IDS = [...existingAdmins, 'eval-user'].join(',');
    }

    // SOUL.md tells the rancher agent these env vars are guaranteed. In eval
    // mode they aren't — without them the agent invents `localhost:8080`-
    // style URLs and judges fail it on "wrong URL pattern". Default to the
    // api's own loopback so the http pattern matches docs; the token is a
    // sandbox value (calls return 401, but tool_usage scoring sees the
    // correct call shape).
    if (!env.RANCH_API_URL) {
      env.RANCH_API_URL = `http://localhost:${process.env.PORT ?? '3333'}`;
    }
    if (!env.RANCH_API_TOKEN) {
      env.RANCH_API_TOKEN = 'eval-sandbox-token';
    }
    env.RANCH_ADMIN = 'true';

    return env;
  }

  /**
   * Sweeps `_ranch_*` namespace directories under <runtime>/.paddock/scenarios.
   *
   * For the CURRENT agent (`agentId`) we delete every leftover regardless of
   * age — the eval lock guarantees no concurrent run for this agent, so
   * anything we find is definitely stale.
   *
   * For OTHER agents we delete entries older than STALE_THRESHOLD_MS (a
   * concurrent run for a different agent might have a fresh dir).
   */
  private async sweepStaleNamespaces(
    scenariosRoot: string,
    agentId: string,
  ): Promise<void> {
    const STALE_THRESHOLD_MS = 15 * 60 * 1000;
    if (!existsSync(scenariosRoot)) return;
    const fs = await import('fs/promises');
    let entries: string[];
    try {
      entries = await readdir(scenariosRoot);
    } catch {
      return;
    }
    const cutoff = Date.now() - STALE_THRESHOLD_MS;
    const ownPrefix = `_ranch_${agentId}_`;
    let swept = 0;
    for (const entry of entries) {
      if (!entry.startsWith('_ranch_')) continue;
      const path = join(scenariosRoot, entry);
      try {
        const isOwn = entry.startsWith(ownPrefix);
        if (!isOwn) {
          const stat = await fs.stat(path);
          if (stat.mtimeMs >= cutoff) continue;
        }
        await rm(path, { recursive: true, force: true });
        swept++;
      } catch {
        // best-effort
      }
    }
    if (swept > 0) {
      this.logger.log(
        `Swept ${swept} stale _ranch_* namespaces from ${scenariosRoot}`,
      );
    }
  }

  private async findReportSince(
    reportsDir: string,
    sinceTs: number,
    wantedScenarioIds: Set<string>,
  ): Promise<{ json: string; md: string } | null> {
    if (!existsSync(reportsDir)) return null;
    const fs = await import('fs/promises');
    const files = await readdir(reportsDir);
    const candidates = files
      .filter((f) => f.startsWith('eval-') && f.endsWith('.json'))
      .map((f) => ({ name: f, path: join(reportsDir, f) }));

    // Newest first
    const stats = await Promise.all(
      candidates.map(async (c) => ({
        ...c,
        mtime: (await fs.stat(c.path)).mtimeMs,
      })),
    );
    stats.filter((s) => s.mtime >= sinceTs).sort((a, b) => b.mtime - a.mtime);

    for (const c of stats) {
      if (c.mtime < sinceTs) continue;
      try {
        const text = await fs.readFile(c.path, 'utf-8');
        const parsed = JSON.parse(text) as PaddockJsonReport;
        const ids = new Set((parsed.results ?? []).map((r) => r.id));
        // Match if our scenario ids are a subset of this report's results
        const matches = [...wantedScenarioIds].every((id) => ids.has(id));
        if (matches) {
          return {
            json: c.path,
            md: c.path.replace(/\.json$/, '.md'),
          };
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private mapOutput(
    input: IPaddockRunnerInput,
    report: PaddockJsonReport,
    reportMd: string,
    cliStderr: string,
  ): IPaddockRunnerOutput {
    const results = report.results ?? [];
    const counts = { pass: 0, fail: 0, partial: 0, skipped: 0 };
    for (const r of results) {
      counts[r.verdict]++;
    }
    const passRate =
      typeof report.passRate === 'number'
        ? report.passRate
        : results.length > 0
          ? counts.pass / results.length
          : 0;

    // Group errors by scenario for synthetic trace output
    const errorsByScenario = new Map<
      string,
      Array<{ phase: string; message: string }>
    >();
    for (const e of report.errors ?? []) {
      const arr = errorsByScenario.get(e.scenario) ?? [];
      arr.push({ phase: e.phase, message: e.message });
      errorsByScenario.set(e.scenario, arr);
    }

    const traces: Record<string, object> = {};
    for (const r of results) {
      traces[r.id] = {
        scenarioId: r.id,
        responses: [],
        toolCalls: [],
        errors: errorsByScenario.get(r.id) ?? [],
        timing: { startedAt: 0, endedAt: 0, totalMs: 0 },
        metadata: {
          agentDir: input.agentDir,
          soulMd: '',
          configJson: '{}',
          toolNames: [],
        },
      };
    }

    return {
      passRate,
      scenarioCount: results.length,
      passCount: counts.pass,
      failCount: counts.fail,
      partialCount: counts.partial,
      skippedCount: counts.skipped,
      results: results.map((r) => ({
        scenarioId: r.id,
        verdict: r.verdict,
        finalScore: r.score,
        agreement: r.agreement,
        dimensionScores: (r.dimensions ?? {}) as Record<string, number>,
        judges: (r.judges ?? []).map((j) => ({
          judgeModel: j.model,
          scores: {} as Record<string, number>,
          reasoning: (j.reasoning ?? {}) as Record<string, string>,
          overallScore: j.score,
          verdict: j.verdict,
          confidence: 0.5,
          suggestions: [],
        })),
        failureReasons: r.failureReasons ?? [],
      })),
      reportJson: report as object,
      reportMd,
      errorMessage:
        results.length === 0 && cliStderr.trim().length > 0
          ? cliStderr.slice(-500)
          : null,
      traces,
    };
  }
}

function scenarioToYaml(s: IPaddockScenarioData): string {
  const lines: string[] = [];
  lines.push(`id: ${yamlString(s.id)}`);
  lines.push(`category: ${s.category}`);
  lines.push(`difficulty: ${s.difficulty}`);
  lines.push(`name: ${yamlString(s.name)}`);
  lines.push(`description: ${yamlString(s.description)}`);
  lines.push(`expectedBehavior: ${yamlString(s.expectedBehavior)}`);
  lines.push('messages:');
  for (const m of s.messages) {
    lines.push(`  - text: ${yamlString(m.text)}`);
    lines.push(`    from: ${yamlString(m.from)}`);
    if (m.delayMs !== undefined) lines.push(`    delayMs: ${m.delayMs}`);
  }
  lines.push('successCriteria:');
  for (const c of s.successCriteria) {
    lines.push(`  - dimension: ${c.dimension}`);
    lines.push(`    description: ${yamlString(c.description)}`);
    lines.push(`    weight: ${c.weight}`);
  }
  if (s.setup?.files || s.setup?.env || s.setup?.tools) {
    lines.push('setup:');
    if (s.setup.files) {
      lines.push('  files:');
      for (const [k, v] of Object.entries(s.setup.files)) {
        lines.push(`    ${yamlString(k)}: ${yamlString(v)}`);
      }
    }
    if (s.setup.env) {
      lines.push('  env:');
      for (const [k, v] of Object.entries(s.setup.env)) {
        lines.push(`    ${k}: ${yamlString(v)}`);
      }
    }
    if (s.setup.tools && s.setup.tools.length > 0) {
      lines.push('  tools:');
      for (const t of s.setup.tools) lines.push(`    - ${yamlString(t)}`);
    }
  }
  return lines.join('\n') + '\n';
}

function yamlString(v: string): string {
  // Always quote strings to avoid YAML parsing edge cases
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}
