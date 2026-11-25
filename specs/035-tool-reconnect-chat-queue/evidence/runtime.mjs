// CLEAN-245 evidence: agent runtimes with the model taken out.
//
// One per seeded agent. Each signs in to the hub as its agent, reports the
// tool state it is told to have (the report runtime 0.40 sends), and answers
// a message with `echo: <text>` after a delay. A small HTTP port lets
// `shots.mjs` set the scene:
//
//   POST /mode   { agent: 'A', mode: 'ready'|'connecting'|'limited'|'refused'|'none' }
//   POST /delay  { agent: 'A', ms: 4000 }
//   POST /reply  { agent: 'A', text: '…' }   the next answer, once
//   POST /status-of { agent: 'R', id: '<agent id>' }   the next answer is what
//        Ranch's `get_agent_status` tool returns for that agent, called the
//        way the runtime calls it: as the agent, for the person of the turn
//   GET  /received?agent=A                    what the hub delivered, in order
//
// `none` is runtime 0.39: it reconnects and reports nothing.
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { API, BRIDLE_API_KEY, CONTROL, REPO, io } from "./lib.mjs";
import { AGENTS } from "./seed.mjs";

const require = createRequire(path.join(REPO, "api/package.json"));
const jwt = require("jsonwebtoken");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

/** What `get_agent_status` says about an agent's tools, in a sentence: the model's part, scripted. */
function wordStatus(json) {
  const tools = json?.tools;
  if (!tools)
    return `${json?.name ?? "The agent"} is ${json?.status}. Its runtime reports nothing about its tool servers.`;
  const lines = tools.servers.map(
    (s) =>
      `- ${s.name}: ${s.state}` +
      (s.attempts ? `, ${s.attempts} attempts` : "") +
      (s.lastError ? `, last error "${s.lastError}"` : ""),
  );
  return `${json.name} is ${json.status}; its tools are ${tools.phase}.\n\n${lines.join("\n")}`;
}

const iso = (agoMs = 0) => new Date(Date.now() - agoMs).toISOString();

/** The report for a mode, as runtime 0.40 words it. */
export function report(mode, startedAgoMs = 60_000) {
  const ranch = {
    id: "ranch",
    name: "Ranch",
    state: "connected",
    since: iso(startedAgoMs),
    attempts: 0,
  };
  const docs = (state, attempts, lastError, agoMs) => ({
    id: "documents",
    name: "Documents",
    state,
    since: iso(agoMs),
    attempts,
    ...(lastError ? { lastError } : {}),
  });
  const startedAt = iso(startedAgoMs);
  if (mode === "connecting") {
    return {
      phase: "connecting",
      since: startedAt,
      startedAt,
      servers: [
        ranch,
        docs("retrying", 2, "connect ECONNREFUSED 10.0.4.17:8080", 20_000),
      ],
    };
  }
  if (mode === "limited") {
    return {
      phase: "limited",
      since: iso(45_000),
      startedAt,
      servers: [
        ranch,
        docs("retrying", 6, "connect ECONNREFUSED 10.0.4.17:8080", 45_000),
      ],
    };
  }
  if (mode === "refused") {
    return {
      phase: "limited",
      since: iso(45_000),
      startedAt,
      servers: [ranch, docs("refused", 1, "HTTP 401 Unauthorized", 45_000)],
    };
  }
  return {
    phase: "ready",
    since: iso(5_000),
    startedAt,
    servers: [ranch, docs("connected", 0, null, 5_000)],
  };
}

class FakeRuntime {
  received = [];
  mode = "ready";
  delayMs = 300;
  nextReply = null;
  statusOf = null;

  /** Call a Ranch tool as this agent, for the person whose turn `msg` is. */
  async tool(name, args, msg) {
    const token = jwt.sign(
      {
        sub: `agent:${this.agent.id}`,
        email: `agent-${this.agent.id}@ranch.local`,
        roles: [this.agent.isAdmin ? "Owner" : "Agent"],
      },
      process.env.JWT_SECRET,
      { expiresIn: "5m" },
    );
    const client = new Client({
      name: "evidence-fake-runtime",
      version: "0.40.0",
    });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${API}/mcp/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    try {
      const actor = msg?.acting?.token
        ? { kind: "person", token: msg.acting.token }
        : { kind: "guest" };
      const result = await client.callTool({
        name,
        arguments: args,
        _meta: { "ranch/actor": actor, "ranch/turn": { client: msg.clientId } },
      });
      const text = (result.content ?? []).map((c) => c.text ?? "").join("\n");
      try {
        return JSON.parse(text);
      } catch {
        return { error: text.slice(0, 200) };
      }
    } finally {
      await client.close().catch(() => {});
    }
  }

  constructor(agent) {
    this.agent = agent;
  }

  async connect() {
    this.socket?.disconnect();
    this.socket = io(`${API}/ws/agent`, {
      transports: ["websocket"],
      auth: { apiKey: BRIDLE_API_KEY, agentId: this.agent.id },
      reconnection: true,
    });
    await new Promise((resolve, reject) => {
      this.socket.once("connect", resolve);
      this.socket.once("connect_error", reject);
    });
    this.socket.on("message", (msg) => void this.onMessage(msg));
    this.socket.on("connect", () => this.say());
    this.say();
  }

  say() {
    if (this.mode !== "none") this.socket.emit("tool_state", report(this.mode));
  }

  async setMode(mode) {
    const was = this.mode;
    this.mode = mode;
    // A runtime that never reported is a new socket: the hub forgets the
    // last report only when the agent's socket goes.
    if (mode === "none" && was !== "none") await this.connect();
    else this.say();
  }

  async onMessage(msg) {
    this.received.push({
      clientId: msg.clientId,
      text: msg.text,
      at: Date.now(),
    });
    this.socket.emit("typing", { clientId: msg.clientId });
    await new Promise((r) => setTimeout(r, this.delayMs));
    let text = this.nextReply ?? `echo: ${msg.text}`;
    this.nextReply = null;
    if (this.statusOf) {
      const json = await this.tool(
        "get_agent_status",
        { id: this.statusOf },
        msg,
      ).catch((err) => ({
        error: err.message,
      }));
      this.statusOf = null;
      this.lastTool = json;
      text = json.error
        ? `The tool refused: ${JSON.stringify(json.error)}`
        : wordStatus(json.data ?? json);
    }
    this.socket.emit("message", { clientId: msg.clientId, text });
  }
}

const runtimes = {};
for (const [key, agent] of Object.entries(AGENTS)) {
  runtimes[key] = new FakeRuntime(agent);
  await runtimes[key].connect();
}

const body = (req) =>
  new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw ? JSON.parse(raw) : {}));
  });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, CONTROL);
    const input = req.method === "POST" ? await body(req) : {};
    const rt = runtimes[input.agent ?? url.searchParams.get("agent") ?? "A"];
    let out = { ok: true };
    try {
      if (!rt) throw new Error("no such agent");
      if (url.pathname === "/mode") await rt.setMode(input.mode);
      else if (url.pathname === "/delay") rt.delayMs = Number(input.ms);
      else if (url.pathname === "/reply") rt.nextReply = String(input.text);
      else if (url.pathname === "/status-of") rt.statusOf = String(input.id);
      else if (url.pathname === "/last-tool")
        out = { result: rt.lastTool ?? null };
      else if (url.pathname === "/received") out = { received: rt.received };
      else if (url.pathname === "/forget") rt.received = [];
      else throw new Error("no such route");
      res.writeHead(200, { "Content-Type": "application/json" });
    } catch (err) {
      out = { ok: false, error: err.message };
      res.writeHead(400, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify(out));
  })
  .listen(Number(new URL(CONTROL).port), "127.0.0.1", () =>
    console.log(
      `fake runtimes up: ${Object.values(AGENTS)
        .map((a) => a.name)
        .join(", ")}`,
    ),
  );
