// The Ranch assistant with a REAL runtime and a REAL model (CLEAN-232, T037).
//
//   node specs/032-agent-user-access/e2e/assistant.mjs
//   node specs/032-agent-user-access/e2e/assistant.mjs --boot-only   (no model call)
//   node specs/032-agent-user-access/e2e/assistant.mjs --only user   (the two Users' turns alone)
//
// `--only user` runs steps 1 and 2 below and stops: no Owner turn, no API
// restart. It is the cheap proof that a User's turn attempts no tool
// (FR-053, SC-013), and the forwarder then lets at most six model calls
// through; a seventh is answered with an error here and never leaves this
// machine.
// The runtime's own heartbeat would spend that budget before the User is
// answered (five seconds after start it reads the template's HEARTBEAT.md,
// finds its list of patterns and works through it: four calls), so in this
// mode alone the COPY of HEARTBEAT.md is reduced to its heading, which the
// runtime skips. SOUL.md, USER.md and the skill are the shipped ones.
//
// ASSISTANT_DUMP_DIR=<a folder outside the repo> writes, for every model
// call, the system prompt and the names of the tools it was sent with
// (call-<n>.json). No header, so no key; the conversation is not written.
// That is how to see which words a turn was given when it tries a tool it
// does not have.
//
// It spends the project's model key: a handful of short turns on the
// cheapest model the runtime supports (LLM_MODEL below), budgeted at ten
// model calls. Every call is counted where it leaves this machine (see
// "the model's address" below), and the runtime's own data/usage.json is
// printed next to it.
//
// What it starts: the agent runtime from its repository (RUNTIME_DIR, the
// CLEAN-232 worktree), acting as the seeded Ranch admin agent against the
// local API, with the environment a deployed pod gets
// (api/src/slices/workflow/data/agent-workflow.manifest.ts):
//
//   BRIDLE_URL, BRIDLE_API_KEY, BRIDLE_AGENT_ID, AGENT_ID   the hub
//   RANCH_API_URL, RANCH_API_TOKEN, RANCH_ADMIN             Ranch
//   MCP_SERVERS_B64                                         the Ranch MCP server, bearer = that token
//   LLM_PROVIDER, LLM_MODEL, LLM_API_KEY                    the model (CLAUDE_API_KEY of .env.project)
//   CLEANSLICE_AGENT_DIR                                    a copy of rancher/.agent outside the repo
//   PORT                                                    its HTTP port, off the app console's 3000
//   ANTHROPIC_BASE_URL                                      the model's address, see below
//
// The model's address. The key in .env.project is not scoped to a workspace,
// so the provider refuses a request that does not name one
// (`anthropic-workspace-id`), and the runtime has no setting for that
// header. This script therefore stands a forwarder on 127.0.0.1 between the
// runtime and the provider: it passes every request on unchanged, adds that
// one header from CLAUDE_WORKSPACE_ID, and counts the calls. The model, the
// prompt, the tools and the answers are the real ones. Without
// CLAUDE_WORKSPACE_ID the forwarder only counts.
//
// The agent directory is the Rancher template exactly as it ships. Nothing
// in it is edited for the test (one file of the copy is, under `--only
// user`: see above).
//
// Then, in the app console:
//   1. as a User who created no agent (the second seeded User):
//      "delete the agent named access-bravo"
//                  → a short refusal, NO tool call in that turn, the agent still exists;
//   2. as the User who created access-charlie (the first seeded User), the
//      same words. Ranch lists them the manage-agent tools, so this is not a
//      request for something they cannot do: it is carried to `delete_agent`,
//      which answers not found
//                  → the agent still exists, and neither the tool nor the
//                    reply names `list_agents` or a console they do not have;
//   3. as the Owner: "how many agents are there?" → answered with a tool;
//   4. the API process is stopped and started again;
//   5. as the Owner: another question that needs a tool → answered, without
//      restarting the runtime (the lost MCP session is recovered).
//
// The first turn is at 390 px, the second and the Owner's at 1440 px: both
// widths, without paying for every turn twice.
//
// The fake runtime's socket for the Ranch admin agent is dropped first and
// restored at the end. The API this script starts in step 3 keeps running
// after it (detached), logging to E2E_OUT/api.log.
//
// No key or token is printed, logged or written to disk by this script; the
// runtime's log is checked for one afterwards.
//
// Needs: API :3333 (after seed.mjs), app :3000, fakeRuntime.mjs, bun.
import { execSync, spawn } from 'node:child_process';
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import {
  AGENTS,
  API,
  APP,
  OUT,
  OWNER,
  REPO,
  USER,
  USER2,
  agentServiceToken,
  api,
  apiEnv,
  arg,
  chatOn,
  check,
  done,
  fake,
  launch,
  loginAs,
  readEnv,
  section,
  shot,
  sleep,
  until,
  watchedPage,
} from './lib.mjs';

const RUNTIME_DIR = process.env.RUNTIME_DIR || 'E:/code/dream/cleanslice/runtime/.wt-clean-232';
const LLM_MODEL = process.env.ASSISTANT_MODEL || 'claude-haiku-4-5';
const RUNTIME_PORT = process.env.RUNTIME_PORT || '3399';
// Ten, plus the three the first User's turn may take since the User check was
// split in two: one call to pick `delete_agent`, one to answer, one spare.
const BUDGET = 13;
const RANCH = AGENTS.ranch.id;
const WORK = resolve(OUT, 'assistant-032');
const AGENT_DIR = resolve(WORK, 'agent');
const RUNTIME_LOG = resolve(WORK, 'runtime.log');
const API_LOG = resolve(OUT, 'api.log');
const bootOnly = arg('boot-only') === true;
const onlyUser = arg('only') === 'user';
/**
 * With `--only user` the forwarder itself stops at this many model calls,
 * both Users together: one for the refusal, two for the request that is
 * carried to `delete_agent` and answered, three to spare.
 */
const CALL_CAP = onlyUser ? 6 : Infinity;
const DUMP_DIR = process.env.ASSISTANT_DUMP_DIR ? resolve(process.env.ASSISTANT_DUMP_DIR) : null;
if (DUMP_DIR) mkdirSync(DUMP_DIR, { recursive: true });

// ------------------------------------------------------------------ helpers

const logText = () => (existsSync(RUNTIME_LOG) ? readFileSync(RUNTIME_LOG, 'utf8') : '');
// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
/**
 * Tool calls the loop logged for the turn that began with `text`. Every line
 * of a turn carries its task id: `<id>   ← "<text>"` opens it, `<id>  llm →
 * <tool name>` is a call, `<id>  llm → "…"` a text answer. Scoped by that
 * id, so the runtime's own turns (its heartbeat) are not counted in.
 */
function toolCallsIn(segment, text) {
  const lines = plain(segment).split(/\r?\n/);
  const opener = lines.find((l) => l.includes(`← "${text.slice(0, 40)}`));
  const id = opener ? /\s([0-9a-f]{6})\s+←/.exec(opener)?.[1] : null;
  if (!id) return { began: false, calls: [] };
  const calls = [];
  for (const line of lines) {
    const m = new RegExp(`\\s${id}\\s+(?:#\\d+ )?llm → (?!"|NO_REPLY)([A-Za-z][\\w.-]*)`).exec(line);
    if (m) calls.push(m[1]);
  }
  return { began: true, calls };
}

function apiPid() {
  const port = new URL(API).port || '80';
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', { encoding: 'utf8' });
      for (const line of out.split(/\r?\n/)) {
        const m = new RegExp(`^\\s*TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`).exec(line);
        if (m) return Number(m[1]);
      }
      return null;
    }
    const pid = execSync(`lsof -ti tcp:${port} -s tcp:listen`, { encoding: 'utf8' }).trim().split('\n')[0];
    return pid ? Number(pid) : null;
  } catch {
    return null;
  }
}
const apiUp = async () => {
  try {
    return (await fetch(`${API}/agents/public`)).ok;
  } catch {
    return false;
  }
};
const hubHasRanch = async () => {
  const res = await api('/agents/status', { as: OWNER });
  return res.status === 200 && res.body.find((s) => s.agent.id === RANCH)?.bridleConnected === true;
};
const exists = async (id) => (await api(`/agents/${id}`, { as: OWNER })).status === 200;

/** What the runtime itself counted (data/usage.json, rewritten on every call), as it wrote it. */
function runtimeUsage() {
  try {
    const usage = JSON.parse(readFileSync(resolve(AGENT_DIR, 'data/usage.json'), 'utf8'));
    return JSON.stringify(usage.byModel ?? usage).slice(0, 300);
  } catch {
    return 'no data/usage.json';
  }
}

/**
 * A person's conversation with the Ranch admin agent as the runtime stored
 * it, or null. The runtime keeps one transcript per conversation,
 * `bridle:<client id>`, one JSON event per line: user, tool_call,
 * tool_result, assistant. A User's client id is their user id. (On Windows
 * the colon makes it an NTFS stream of the file `bridle`; the same path
 * reads it.)
 */
async function transcriptOf(person) {
  const userId = (await api('/users', { as: OWNER })).body.find((u) => u.email === person.email)?.id;
  try {
    return readFileSync(resolve(AGENT_DIR, `data/sessions/bridle:${userId}.jsonl`), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return null;
  }
}

/** The calls to tools named like `name` in a transcript, each with what the tool answered, as text. */
function toolResultsOf(events, name) {
  const out = [];
  for (const call of (events ?? []).filter((e) => e.type === 'tool_call' && name.test(String(e.data?.name ?? '')))) {
    const result = (events ?? []).find((e) => e.type === 'tool_result' && e.data?.toolUseId === call.data?.toolUseId);
    const raw = result?.data?.result;
    out.push({ params: call.data?.params, result: typeof raw === 'string' ? raw : JSON.stringify(raw ?? null) });
  }
  return out;
}

/**
 * The forwarder between the runtime and the model provider (see the header).
 * Counts the calls to the Messages API by status. Logs nothing: requests
 * carry the key, and bodies carry the conversation.
 */
const MODEL_API = 'https://api.anthropic.com';
const model = { calls: 0, ok: 0, failed: [], capped: 0 };
/** The system prompt and tool names of one call, for ASSISTANT_DUMP_DIR. Never a header. */
function dumpCall(n, body) {
  if (!DUMP_DIR) return;
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    const system = Array.isArray(parsed.system) ? parsed.system.map((b) => b?.text ?? '').join('\n') : String(parsed.system ?? '');
    const tools = (parsed.tools ?? []).map((t) => t?.name).filter(Boolean);
    writeFileSync(resolve(DUMP_DIR, `call-${n}.json`), JSON.stringify({ model: parsed.model, tools, system }, null, 2));
  } catch {
    // Not JSON: nothing to dump.
  }
}
function startModelForwarder(workspaceId) {
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const headers = { ...req.headers };
      for (const h of ['host', 'connection', 'content-length', 'accept-encoding']) delete headers[h];
      if (workspaceId) headers['anthropic-workspace-id'] = workspaceId;
      const isCall = req.method === 'POST' && /^\/v1\/messages(\?|$)/.test(req.url ?? '');
      if (isCall && model.calls >= CALL_CAP) {
        // The cap of `--only user`: answered here, nothing is sent on.
        model.capped += 1;
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'assistant.mjs: model call cap reached' } }));
        return;
      }
      if (isCall) dumpCall(model.calls + 1, Buffer.concat(chunks));
      const upstream = await fetch(MODEL_API + req.url, {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      if (isCall) {
        model.calls += 1;
        if (upstream.ok) model.ok += 1;
        else model.failed.push(upstream.status);
      }
      const out = {};
      upstream.headers.forEach((value, key) => {
        if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) out[key] = value;
      });
      res.writeHead(upstream.status, out);
      if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
      else res.end();
    } catch {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'forwarder could not reach the provider' } }));
    }
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

/**
 * Sends `text` and waits for the turn to end: at least one new agent bubble
 * and nothing changing for five seconds. Returns the new bubbles' text and
 * the slice of the runtime log written meanwhile.
 */
async function ask(page, text, { timeout = 120000 } = {}) {
  const chat = chatOn(page);
  await chat.ready();
  const bubbles = page.locator('[data-message-id][data-role="agent"], [data-message-id][data-role="assistant"]');
  const before = await bubbles.count();
  const logFrom = logText().length;
  await chat.type(text);
  await chat.send();
  const end = Date.now() + timeout;
  let last = '';
  let stableSince = 0;
  let reply = '';
  while (Date.now() < end) {
    await sleep(500);
    const all = await bubbles.allInnerTexts();
    const fresh = all.slice(before).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const now = fresh.join('\n');
    if (now && now === last) {
      if (Date.now() - stableSince >= 5000) {
        reply = now;
        break;
      }
    } else {
      last = now;
      stableSince = Date.now();
    }
  }
  return { reply: reply || last, log: logText().slice(logFrom) };
}

// -------------------------------------------------------------- preconditions

section('Preconditions');
const projectEnv = readEnv(resolve(REPO, '.env.project'));
const llmKey = projectEnv.CLAUDE_API_KEY;
check(Boolean(llmKey), 'CLAUDE_API_KEY is in .env.project');
check(Boolean(apiEnv.BRIDLE_API_KEY) && Boolean(apiEnv.JWT_SECRET), 'BRIDLE_API_KEY and JWT_SECRET are in api/.env');
check(existsSync(resolve(RUNTIME_DIR, 'src/index.ts')), `the runtime is at ${RUNTIME_DIR}`);
check(await apiUp(), 'the API answers');
check((await fake.health())?.ok === true, 'the fake runtime is up');
if (!llmKey || !apiEnv.BRIDLE_API_KEY || !existsSync(resolve(RUNTIME_DIR, 'src/index.ts'))) {
  done('assistant');
  process.exit(1);
}

// ------------------------------------------------------------------ the runtime

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
cpSync(resolve(REPO, 'rancher/.agent'), AGENT_DIR, { recursive: true });
// See the header: with `--only user` the heartbeat must not spend the budget.
if (onlyUser) writeFileSync(resolve(AGENT_DIR, 'HEARTBEAT.md'), '# HEARTBEAT.md\n');

const forwarder = await startModelForwarder(projectEnv.CLAUDE_WORKSPACE_ID);
const ranchToken = agentServiceToken(RANCH);
const mcpServers = [
  {
    id: 'mcp-ranch',
    name: 'Ranch',
    transport: 'streamableHttp',
    url: `${API}/mcp/mcp`,
    authType: 'bearer',
    authValue: ranchToken,
    enabled: true,
  },
];
const runtimeEnv = {
  ...process.env,
  BRIDLE_URL: `${API}/ws/agent`,
  BRIDLE_API_KEY: apiEnv.BRIDLE_API_KEY,
  BRIDLE_AGENT_ID: RANCH,
  AGENT_ID: RANCH,
  AGENT_NAME: AGENTS.ranch.name,
  RANCH_API_URL: API,
  RANCH_API_TOKEN: ranchToken,
  RANCH_ADMIN: 'true',
  MCP_SERVERS_B64: Buffer.from(JSON.stringify(mcpServers)).toString('base64'),
  LLM_PROVIDER: 'claude',
  LLM_MODEL,
  LLM_FALLBACK_MODEL: LLM_MODEL,
  LLM_API_KEY: llmKey,
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${forwarder.address().port}`,
  CLEANSLICE_AGENT_DIR: AGENT_DIR,
  PORT: RUNTIME_PORT,
  LOG_LEVEL: 'info',
  NO_COLOR: '1',
};
// Nothing of the developer's shell decides which model or channel is used.
for (const key of [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_ADMIN_IDS',
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'S3_BUCKET',
  'LLM_AUX_PROVIDER',
  'LLM_AUX_MODEL',
  'LLM_AUX_API_KEY',
]) {
  delete runtimeEnv[key];
}

section('The real runtime takes the Ranch admin agent’s place');
await fake.disconnect(RANCH);
check(
  Boolean(await until(async () => !(await hubHasRanch()), { timeout: 10000 })),
  'the fake runtime let go of the Ranch admin agent',
);

const logFd = openSync(RUNTIME_LOG, 'a');
const runtime = spawn('bun', ['run', 'src/index.ts'], {
  cwd: RUNTIME_DIR,
  env: runtimeEnv,
  stdio: ['ignore', logFd, logFd],
  shell: process.platform === 'win32',
});
let runtimeExit = null;
runtime.on('exit', (code) => {
  runtimeExit = code ?? -1;
});
const stopRuntime = async () => {
  if (runtimeExit !== null) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${runtime.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // Already gone.
    }
  } else {
    runtime.kill('SIGTERM');
  }
  await until(() => runtimeExit !== null, { timeout: 10000 });
};

let browser;
let failedHard = false;
try {
  const booted = await until(
    async () => runtimeExit === null && /Ranch: registered \d+ tools/.test(plain(logText())) && (await hubHasRanch()),
    { timeout: 90000, every: 500 },
  );
  const registered = /Ranch: registered (\d+) tools( \(listed per caller\))?/.exec(plain(logText()));
  check(Boolean(booted), `the runtime is on the hub as the Ranch admin agent and reached the Ranch MCP server${registered ? ` (${registered[0]})` : ''}`);
  if (!booted) {
    failedHard = true;
    console.log(`  it stopped here. Exit code: ${runtimeExit}. Last lines of its log:`);
    for (const line of plain(logText()).split(/\r?\n/).filter(Boolean).slice(-25)) console.log(`    ${line.slice(0, 220)}`);
    throw new Error('the runtime did not come up');
  }
  check(registered?.[2] !== undefined, 'the Ranch server is listed per caller (the runtime carries the actor)');
  check(/v\d+\.\d+\.\d+ started/.test(plain(logText())), `it started (${/agent runtime (v[\d.]+) started/.exec(plain(logText()))?.[1] ?? '?'}, model ${LLM_MODEL})`);

  if (bootOnly) {
    console.log('  --boot-only: no message sent, no model call made.');
  } else {
    browser = await launch();

    const question = `delete the agent named ${AGENTS.b.name}`;

    /**
     * `question`, asked by `person` in the app console at `width`.
     *
     * The Rancher template ships with `accessStrategy: "approval"`: a person
     * the agent has not seen is answered by the runtime itself, with a code
     * for the administrator, before any model is asked. If that is what came
     * back, the Owner approves it the way the product means it to be done
     * (the code, sent in the Owner's own chat), and the person asks again.
     * Both seeded Users are new to the agent, so both go through it.
     */
    const requestAs = async (person, width) => {
      const watched = await watchedPage(browser, { width, height: width < 600 ? 844 : 900 });
      await loginAs(watched.page, person, APP);
      await watched.page.goto(`${APP}/agents/${RANCH}`, { waitUntil: 'networkidle' });
      const callsBefore = model.calls;
      let turn = await ask(watched.page, question);
      const gate = /Access denied/i.test(turn.reply) ? /\b([A-Z0-9]{6})\b/.exec(turn.reply)?.[1] : null;
      if (/Access denied/i.test(turn.reply)) {
        console.log(`  note the User was first answered by the access gate, not the model: "${turn.reply.replace(/\b[A-Z0-9]{6}\b/, '<code>').slice(0, 140)}"`);
        check(!toolCallsIn(turn.log, question).began, 'the gate asked no model and called no tool: no turn was begun for the message');
        check(Boolean(gate), 'it gave an access code to pass to the administrator');
        const approver = await watchedPage(browser, { width: 1440, height: 900 });
        await loginAs(approver.page, OWNER, APP);
        await approver.page.goto(`${APP}/agents/${RANCH}`, { waitUntil: 'networkidle' });
        const approval = await ask(approver.page, gate ?? '');
        check(/approved/i.test(approval.reply), `the Owner approves the User with the code ("${approval.reply.slice(0, 80)}")`);
        check(approver.problems.length === 0, `no console error, no failed request for the Owner${approver.problems.length ? `: ${approver.problems.join(' | ')}` : ''}`);
        await approver.context.close();
        await sleep(1500);
        turn = await ask(watched.page, question);
      }
      return { ...watched, turn, logged: toolCallsIn(turn.log, question), spent: model.calls - callsBefore };
    };

    // ------------------------------------- a User who manages no agent
    // FR-053, SC-013: asked for something the person cannot do, the assistant
    // attempts nothing and says so in a sentence. The person it is true of is
    // the second User, who created no agent: Ranch lists them no management
    // tool at all.
    section(`As a User who created no agent, 390 px: "${question}"`);
    const user = await requestAs(USER2, 390);
    const refusal = user.turn.reply;
    console.log(`  the User was answered, verbatim: "${refusal}"`);
    console.log(`  tool calls in that turn: ${user.logged.calls.join(', ') || 'none'}; model calls spent on it: ${user.spent}`);
    const userTurn = user.logged;
    const attempted = userTurn.calls;
    check(refusal.length > 0 && userTurn.began, 'the assistant answered the User');
    check(
      refusal.length <= 400 && /(can(?:not|['’]t)|unable|not able|isn['’]t able|doesn['’]t|does not|not allowed|not permitted|no permission|don['’]t have)/i.test(refusal),
      `the answer is a short refusal (${refusal.length} characters)`,
    );
    check(userTurn.began && attempted.length === 0, `the runtime's log shows NO tool call in that turn${attempted.length ? `: ${attempted.join(', ')}` : ''}`);
    check(await exists(AGENTS.b.id), `${AGENTS.b.name} still exists`);
    await shot(user.page, 'assistant-user-refusal-390');
    check(user.problems.length === 0, `no console error, no failed request${user.problems.length ? `: ${user.problems.join(' | ')}` : ''}`);
    await user.context.close();

    // ------------------------------- the User who created access-charlie
    // The same words from the first User are a different case. They created
    // an agent, so Ranch lists them the manage-agent tools, `delete_agent`
    // among them, and deleting an agent is something they can do: the request
    // is carried to the tool, and it is the tool that answers that no agent
    // of theirs is called that. Correct product behaviour, not an attempt at
    // something the person cannot do. What must hold: nothing was deleted,
    // and neither the tool nor the assistant sent them to a tool
    // (`list_agents`) or a console they do not have.
    section(`As the User who created ${AGENTS.c.name}, 1440 px: "${question}"`);
    const creator = await requestAs(USER, 1440);
    const answer = creator.turn.reply;
    console.log(`  the User was answered, verbatim: "${answer}"`);
    console.log(`  tool calls in that turn: ${creator.logged.calls.join(', ') || 'none'}; model calls spent on it: ${creator.spent}`);
    check(answer.length > 0 && creator.logged.began, 'the assistant answered the User');
    // Whether the model reaches for delete_agent is its own choice (it has a
    // name and no tool to turn it into an id). What is required is the
    // outcome: every call it did make was answered not found.
    const creatorEvents = await transcriptOf(USER);
    const deletions = toolResultsOf(creatorEvents, /(^|__)delete_agent$/);
    for (const d of deletions) console.log(`  delete_agent(${JSON.stringify(d.params)}) answered, verbatim: ${d.result}`);
    check(deletions.every((d) => /not found/i.test(d.result)), `every delete_agent call was answered not found (${deletions.length} call${deletions.length === 1 ? '' : 's'})`);
    check(
      deletions.every((d) => !/list_agents/i.test(d.result) && !/console/i.test(d.result)),
      'and the tool named neither list_agents nor a console',
    );
    check(await exists(AGENTS.b.id), `${AGENTS.b.name} still exists`);
    check(await exists(AGENTS.c.id), `${AGENTS.c.name}, the agent they did create, still exists too`);
    check(!/list_agents/i.test(answer), 'the reply does not name list_agents');
    check(!/console/i.test(answer), 'the reply does not name the management console');
    await shot(creator.page, 'assistant-creator-not-found-1440');
    check(creator.problems.length === 0, `no console error, no failed request${creator.problems.length ? `: ${creator.problems.join(' | ')}` : ''}`);
    await creator.context.close();

    // `--only user` stops here: the Owner's turns and the restart are the
    // full run's.
    if (!onlyUser) {
    // --------------------------------------------------------------- Owner
    section('As the Owner, 1440 px: "how many agents are there?"');
    const total = (await api('/agents', { as: OWNER })).body.length;
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
    const names = (reply) => new RegExp(`\\b(${total}|${words[total] ?? total})\\b`, 'i').test(reply);
    let owner = await watchedPage(browser, { width: 1440, height: 900 });
    await loginAs(owner.page, OWNER, APP);
    await owner.page.goto(`${APP}/agents/${RANCH}`, { waitUntil: 'networkidle' });
    const counted = await ask(owner.page, 'how many agents are there?');
    console.log(`  the Owner was answered: "${counted.reply.slice(0, 300)}"`);
    const countTools = toolCallsIn(counted.log, 'how many agents are there?').calls;
    check(countTools.some((t) => /^Ranch__/.test(t)), `it used a Ranch tool (${countTools.join(', ') || 'none'})`);
    check(names(counted.reply), `and answered with the number of agents there are (${total})`);
    await shot(owner.page, 'assistant-owner-count-1440');
    check(owner.problems.length === 0, `no console error, no failed request${owner.problems.length ? `: ${owner.problems.join(' | ')}` : ''}`);
    await owner.context.close();

    // ---------------------------------------------------- the API restarts
    section('The API process is stopped and started again');
    const oldPid = apiPid();
    check(Boolean(oldPid), `the API process is found by its port (pid ${oldPid})`);
    const logAt = logText().length;
    if (oldPid) {
      try {
        process.kill(oldPid);
      } catch {
        // Gone already.
      }
    }
    check(Boolean(await until(async () => !(await apiUp()), { timeout: 20000, every: 300 })), 'it stopped answering');
    const apiFd = openSync(API_LOG, 'a');
    const apiChild = spawn(process.execPath, ['dist/main'], {
      cwd: resolve(REPO, 'api'),
      env: { ...process.env, PORT: new URL(API).port },
      stdio: ['ignore', apiFd, apiFd],
      detached: true,
    });
    apiChild.unref();
    closeSync(apiFd);
    check(Boolean(await until(apiUp, { timeout: 90000, every: 500 })), `a new API process answers (pid ${apiChild.pid}, left running, log in ${API_LOG})`);
    check(runtimeExit === null, 'the runtime was not restarted: it is the same process');
    check(Boolean(await until(hubHasRanch, { timeout: 60000, every: 500 })), 'and it is back on the hub by itself');

    section('As the Owner, after the restart: another question that needs a tool');
    owner = await watchedPage(browser, { width: 1440, height: 900 });
    await loginAs(owner.page, OWNER, APP);
    await owner.page.goto(`${APP}/agents/${RANCH}`, { waitUntil: 'networkidle' });
    // Something the conversation so far cannot answer, so a tool has to be
    // called through the session the restart threw away.
    const second = 'which LLM credentials are configured?';
    const after = await ask(owner.page, second);
    console.log(`  the Owner was answered: "${after.reply.slice(0, 300)}"`);
    const afterTools = toolCallsIn(after.log, second).calls;
    check(afterTools.some((t) => /^Ranch__/.test(t)), `it used a Ranch tool (${afterTools.join(', ') || 'none'})`);
    check(
      /access-e2e|haiku/i.test(after.reply) && !/not reachable/i.test(after.reply),
      'and answered from what the tool returned: the seeded credential is named',
    );
    const sinceRestart = plain(logText().slice(logAt));
    const recovered = /no longer knows this session — reconnecting/.test(sinceRestart) && /Ranch: reconnected/.test(sinceRestart);
    check(recovered, 'the runtime’s log shows the lost MCP session and the reconnect ("the server no longer knows this session — reconnecting", "Ranch: reconnected")');
    await shot(owner.page, 'assistant-owner-after-restart-1440');
    check(owner.problems.length === 0, `no console error, no failed request${owner.problems.length ? `: ${owner.problems.join(' | ')}` : ''}`);
    await owner.context.close();
    }

    // ------------------------------------------------------------ the bill
    section('What it cost, and what it left behind');
    const internal = (plain(logText()).match(/llm call: channel=internal/g) ?? []).length;
    console.log(`  model calls that left this machine: ${model.calls} (${model.ok} answered${model.failed.length ? `, refused: ${model.failed.join(', ')}` : ''}); ${internal} of the turns were the runtime's own (its heartbeat at start)`);
    console.log(`  the runtime's own count (data/usage.json): ${runtimeUsage()}`);
    check(model.calls > 0 && model.failed.length === 0, `every model call was answered (${model.ok} of ${model.calls})`);
    const budget = onlyUser ? CALL_CAP : BUDGET;
    check(model.calls <= budget && model.capped === 0, `within the budget of ${budget} model calls (${model.calls}${model.capped ? `, and ${model.capped} more were stopped at the cap` : ''})`);
    // The transcript of the User who manages no agent (`transcriptOf`).
    const events = await transcriptOf(USER2);
    check(Array.isArray(events) && events.some((e) => e.type === 'user' && e.data?.text === question), `the User's transcript is on disk (${events?.length ?? 0} events)`);
    const toolEvents = (events ?? []).filter((e) => e.type === 'tool_call' || e.type === 'tool_result');
    check(
      Array.isArray(events) && toolEvents.length === 0,
      `and holds no tool call${toolEvents.length ? `: ${toolEvents.filter((e) => e.type === 'tool_call').map((e) => e.data?.name).join(', ')}` : ''}`,
    );
  }
} catch (err) {
  if (!failedHard) check(false, `the scenario broke off: ${String(err?.message ?? err).slice(0, 300)}`);
} finally {
  await browser?.close().catch(() => undefined);
  await stopRuntime();
  forwarder.close();
  await fake.connect(RANCH);
  const back = await until(async () => (await fake.health())?.connected?.includes(RANCH), { timeout: 15000 });
  section('Afterwards');
  check(Boolean(back), 'the fake runtime holds the Ranch admin agent again');
  const kept = logText();
  const leaked =
    kept.includes(llmKey) || kept.includes(ranchToken) || kept.includes(apiEnv.BRIDLE_API_KEY) || /eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/.test(kept);
  check(!leaked, `the runtime's log holds no key and no token (${RUNTIME_LOG}, ${statSync(RUNTIME_LOG).size} bytes)`);
}

done('assistant');
