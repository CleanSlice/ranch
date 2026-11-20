// CLEAN-236 scenarios: an agent runtime with the model taken out.
//
// It signs in to the hub as an agent, records every message the hub sends
// it, and answers with whatever the scenario's handler returns. A handler
// can call Ranch tools the way the runtime does: with the actor the runtime
// would state for that turn (contracts/handover.md §3), which is the whole
// point. `mode: '0.35'` is the runtime before this change: it knows nothing
// of a hand-over, so a colleague's question is a guest's turn, and it names
// no conversation on a tool call.
import { createRequire } from 'node:module';
import path from 'node:path';
import { API, BRIDLE_API_KEY, REPO, io } from './lib.mjs';
import { agentToken } from './seed.mjs';

const require = createRequire(path.join(REPO, 'api/package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

export class FakeRuntime {
  /** Every message the hub delivered, as received. */
  received = [];
  /** `(msg, runtime) => reply text`. */
  handler = async (msg) => `echo: ${msg.text}`;

  constructor(agent, { mode = '0.36' } = {}) {
    this.agent = agent;
    this.mode = mode;
  }

  async start() {
    this.socket = io(`${API}/ws/agent`, {
      transports: ['websocket'],
      auth: { apiKey: BRIDLE_API_KEY, agentId: this.agent.id },
      reconnection: false,
    });
    await new Promise((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('connect_error', reject);
      this.socket.once('disconnect', () => reject(new Error('hub refused the agent socket')));
    });
    this.socket.on('message', (msg) => void this.onMessage(msg));
    return this;
  }

  async onMessage(msg) {
    this.received.push(msg);
    let text;
    try {
      text = await this.handler(msg, this);
    } catch (err) {
      text = `handler failed: ${err.message}`;
    }
    this.socket.emit('message', { clientId: msg.clientId, text: String(text) });
  }

  /** The actor this version of the runtime states for a turn. */
  actorOf(msg) {
    if (this.mode !== '0.35' && msg?.handover?.token) {
      return { kind: 'peer', token: msg.handover.token };
    }
    if (msg?.acting?.token) return { kind: 'person', token: msg.acting.token };
    return { kind: 'guest' };
  }

  meta(msg, actor = this.actorOf(msg)) {
    const meta = { 'ranch/actor': actor };
    if (this.mode !== '0.35' && msg?.clientId) meta['ranch/turn'] = { client: msg.clientId };
    return meta;
  }

  async mcp() {
    if (!this.client) {
      const transport = new StreamableHTTPClientTransport(new URL(`${API}/mcp/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${agentToken(this.agent)}` } },
      });
      this.client = new Client({ name: 'e2e-fake-runtime', version: this.mode });
      await this.client.connect(transport);
    }
    return this.client;
  }

  /** The tools Ranch lists for the turn of `msg` (or for a stated actor). */
  async tools(msg, actor) {
    const client = await this.mcp();
    const listed = await client.listTools({ _meta: { 'ranch/actor': actor ?? this.actorOf(msg) } });
    return listed.tools;
  }

  /**
   * Call a Ranch tool in the turn of `msg`. Returns `{ ok, text, json }`:
   * `ok` is false when Ranch refused or the tool failed.
   */
  async tool(name, args, msg, actor) {
    const client = await this.mcp();
    try {
      const result = await client.callTool({
        name,
        arguments: args ?? {},
        _meta: this.meta(msg, actor),
      });
      const text = (result.content ?? []).map((c) => c.text ?? '').join('\n');
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      const refused = result.isError === true || (json && typeof json === 'object' && 'error' in json);
      return { ok: !refused, text, json };
    } catch (err) {
      return { ok: false, text: String(err.message ?? err), json: undefined };
    }
  }

  async stop() {
    await this.client?.close().catch(() => {});
    this.socket?.disconnect();
  }
}

/** Start one fake runtime per agent; `stop()` ends them all. */
export async function runtimes(agents, opts = {}) {
  const started = {};
  for (const [key, agent] of Object.entries(agents)) {
    started[key] = await new FakeRuntime(agent, opts[key] ?? {}).start();
  }
  return {
    ...started,
    async stop() {
      for (const rt of Object.values(started)) await rt.stop();
    },
  };
}
