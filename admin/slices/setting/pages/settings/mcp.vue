<script setup lang="ts">
import { Badge } from '#theme/components/ui/badge';
import { Button } from '#theme/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '#theme/components/ui/tabs';
import { IconCheck, IconCopy, IconExternalLink } from '@tabler/icons-vue';

// Public URL of the API as seen from outside the cluster. The admin app is
// typically served at admin.<domain>; the API at api.<domain>. We swap the
// first label as a sensible default — the user can still edit the box
// before copying snippets if their topology is different.
const apiBaseUrl = ref('');
onMounted(() => {
  const origin = window.location.origin;
  apiBaseUrl.value = origin.replace(/^https?:\/\/admin\./, (m) =>
    m.replace('admin.', 'api.'),
  );
});

const mcpUrl = computed(() => `${apiBaseUrl.value.replace(/\/$/, '')}/mcp/mcp`);

// Curated list — mirrors the `@Tool` decorators in api/src/slices/rancher/rancher.tool.ts.
// Kept manual rather than fetched: this page documents the *contract*, not the
// live runtime. If a tool is added on the API side, update this list too.
const tools = [
  { name: 'list_agents', desc: 'List every agent on this Ranch with status, template, and resources.' },
  { name: 'get_agent', desc: 'Get a single agent by id, including current status and config.' },
  { name: 'restart_agent', desc: 'Restart an agent pod. Use after editing its files or LLM credential.' },
  { name: 'set_agent_admin', desc: 'Promote/demote an agent to Ranch admin (single-admin invariant).' },
  { name: 'list_templates', desc: 'List all agent templates (image + defaults pods are spawned from).' },
  { name: 'get_template', desc: 'Get a template by id, including image, defaultResources, attached skill ids.' },
  { name: 'set_template_skills', desc: 'Replace the full set of skills attached to a template (exhaustive).' },
  { name: 'list_llms', desc: 'List configured LLM credentials (provider, model, status).' },
  { name: 'list_skills', desc: 'List skills available in the Ranch.' },
  { name: 'list_agent_files', desc: "List files in an agent's S3 prefix (mounted into the pod's .agent/ dir)." },
  { name: 'read_agent_file', desc: 'Read a single agent file by relative path (SOUL.md, MEMORY.md, ...).' },
  { name: 'write_agent_file', desc: 'Write/replace an agent file. Restart the agent for changes to apply.' },
  { name: 'agent_usage', desc: 'Recent token usage records for an agent (default 30 days).' },
  { name: 'list_settings', desc: 'List all platform settings, optionally filtered by group.' },
  { name: 'upsert_setting', desc: 'Create or replace a setting by group/name.' },
];

const claudeDesktopConfig = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        ranch: {
          url: mcpUrl.value,
          headers: {
            Authorization: 'Bearer YOUR_RANCH_API_TOKEN',
          },
        },
      },
    },
    null,
    2,
  ),
);

const cleansliceConfig = computed(() =>
  JSON.stringify(
    {
      mcps: [
        {
          name: 'ranch',
          transport: 'streamableHttp',
          url: mcpUrl.value,
          authType: 'bearer',
          authValue: 'YOUR_RANCH_API_TOKEN',
          enabled: true,
        },
      ],
    },
    null,
    2,
  ),
);

const curlExample = computed(() =>
  [
    `curl -N "${mcpUrl.value}" \\`,
    '  -H "Authorization: Bearer YOUR_RANCH_API_TOKEN" \\',
    '  -H "Content-Type: application/json" \\',
    '  -H "Accept: application/json, text/event-stream" \\',
    `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`,
  ].join('\n'),
);

const copied = ref<string | null>(null);
async function copy(text: string, key: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = key;
    setTimeout(() => {
      if (copied.value === key) copied.value = null;
    }, 1500);
  } catch {
    /* clipboard blocked — silent */
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h2 class="text-xl font-semibold">MCP server</h2>
      <p class="text-sm text-muted-foreground">
        This Ranch exposes its admin API as an MCP server. Any external agent
        — Claude Desktop, Cursor, a custom LLM runtime — can connect to it
        and use the tools below to manage agents, templates, files, and
        settings on this Ranch.
      </p>
    </div>

    <!-- Connection details -->
    <Card>
      <CardHeader>
        <CardTitle>Connection</CardTitle>
        <CardDescription>
          Endpoint, transport, and authentication for connecting an external MCP client.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <div class="grid gap-4 sm:grid-cols-[8rem_1fr] items-baseline">
          <div class="text-sm text-muted-foreground">Endpoint URL</div>
          <div class="flex items-center gap-2">
            <code class="rounded bg-muted px-2 py-1 text-xs font-mono break-all flex-1">
              {{ mcpUrl }}
            </code>
            <Button
              size="sm"
              variant="outline"
              class="gap-1 shrink-0"
              :title="copied === 'url' ? 'Copied' : 'Copy URL'"
              @click="copy(mcpUrl, 'url')"
            >
              <component :is="copied === 'url' ? IconCheck : IconCopy" class="size-3.5" />
              {{ copied === 'url' ? 'Copied' : 'Copy' }}
            </Button>
          </div>

          <div class="text-sm text-muted-foreground">Transport</div>
          <div class="flex items-center gap-2">
            <Badge variant="secondary">streamableHttp</Badge>
            <span class="text-xs text-muted-foreground">
              Modern MCP HTTP transport (the SDK's <code>StreamableHTTPClientTransport</code>).
            </span>
          </div>

          <div class="text-sm text-muted-foreground">Auth</div>
          <div class="flex items-center gap-2">
            <Badge variant="secondary">Bearer token</Badge>
            <span class="text-xs text-muted-foreground">
              Header: <code class="font-mono">Authorization: Bearer &lt;token&gt;</code>
            </span>
          </div>
        </div>

        <p class="text-xs text-muted-foreground border-l-2 pl-3 py-1">
          The endpoint is auto-derived from the admin URL. If your topology
          puts the API somewhere else, edit the value before copying:
        </p>
        <div class="flex items-center gap-2">
          <input
            v-model="apiBaseUrl"
            class="flex-1 rounded border bg-background px-2 py-1 text-xs font-mono"
            placeholder="https://api.your-domain.com"
          >
        </div>
      </CardContent>
    </Card>

    <!-- Auth -->
    <Card>
      <CardHeader>
        <CardTitle>Getting a token</CardTitle>
        <CardDescription>
          Two kinds of tokens work. Pick based on lifetime and audit needs.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-3 text-sm">
        <div>
          <div class="font-medium">User JWT (short-lived)</div>
          <p class="text-xs text-muted-foreground mt-1">
            The token returned by <code>POST /auth/login</code>. Tied to your
            user account, expires per JWT settings (typically hours). Good for
            personal/local use, easy to rotate by logging in again. Inherits
            your Owner/Admin role — sees and can mutate everything.
          </p>
        </div>
        <div>
          <div class="font-medium">Agent service token (long-lived)</div>
          <p class="text-xs text-muted-foreground mt-1">
            JWT minted by Ranch for an agent (365-day expiry, role
            <code>Owner</code> for admin agents, <code>Agent</code> for the rest).
            Stable and machine-friendly — preferred for an external agent
            running 24/7. The simplest way to obtain one: create a dummy
            admin agent in this Ranch, copy its <code>RANCH_API_TOKEN</code>
            from the pod env (<code>kubectl exec</code>), and use that
            verbatim. Revoke by deleting the agent.
          </p>
        </div>
      </CardContent>
    </Card>

    <!-- Available tools -->
    <Card>
      <CardHeader>
        <CardTitle>Available tools</CardTitle>
        <CardDescription>
          Exposed via the standard MCP <code>tools/list</code>. The connecting
          LLM sees them as native tools; you don't need to plumb anything else.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul class="flex flex-col gap-2">
          <li
            v-for="t in tools"
            :key="t.name"
            class="flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2"
          >
            <code class="font-mono text-xs font-medium">{{ t.name }}</code>
            <span class="text-xs text-muted-foreground">{{ t.desc }}</span>
          </li>
        </ul>
      </CardContent>
    </Card>

    <!-- Setup examples -->
    <Card>
      <CardHeader>
        <CardTitle>Connection examples</CardTitle>
        <CardDescription>
          Drop-in snippets. Replace <code>YOUR_RANCH_API_TOKEN</code> with a real token from above.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs default-value="cleanslice">
          <TabsList>
            <TabsTrigger value="cleanslice">CleanSlice runtime</TabsTrigger>
            <TabsTrigger value="claude">Claude Desktop</TabsTrigger>
            <TabsTrigger value="curl">cURL (verify)</TabsTrigger>
          </TabsList>

          <TabsContent value="cleanslice" class="mt-3">
            <p class="text-xs text-muted-foreground mb-2">
              Add to <code>.agent/agent.config.json</code> under the
              <code>mcps</code> array. The runtime opens an MCP client at boot
              and merges its tools into the global registry.
            </p>
            <div class="relative">
              <pre class="rounded-md border bg-muted p-3 text-xs overflow-x-auto"><code>{{ cleansliceConfig }}</code></pre>
              <Button
                size="sm"
                variant="ghost"
                class="absolute top-2 right-2"
                @click="copy(cleansliceConfig, 'cleanslice')"
              >
                <component :is="copied === 'cleanslice' ? IconCheck : IconCopy" class="size-3.5" />
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="claude" class="mt-3">
            <p class="text-xs text-muted-foreground mb-2">
              Add under <code>mcpServers</code> in your
              <code>claude_desktop_config.json</code>. Restart Claude Desktop
              to pick up the change.
            </p>
            <div class="relative">
              <pre class="rounded-md border bg-muted p-3 text-xs overflow-x-auto"><code>{{ claudeDesktopConfig }}</code></pre>
              <Button
                size="sm"
                variant="ghost"
                class="absolute top-2 right-2"
                @click="copy(claudeDesktopConfig, 'claude')"
              >
                <component :is="copied === 'claude' ? IconCheck : IconCopy" class="size-3.5" />
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="curl" class="mt-3">
            <p class="text-xs text-muted-foreground mb-2">
              Quick sanity check — should stream back a JSON-RPC response
              listing the tools above.
            </p>
            <div class="relative">
              <pre class="rounded-md border bg-muted p-3 text-xs overflow-x-auto"><code>{{ curlExample }}</code></pre>
              <Button
                size="sm"
                variant="ghost"
                class="absolute top-2 right-2"
                @click="copy(curlExample, 'curl')"
              >
                <component :is="copied === 'curl' ? IconCheck : IconCopy" class="size-3.5" />
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>

    <!-- Spec footer -->
    <p class="text-xs text-muted-foreground">
      Implementing your own MCP client?
      <a
        href="https://modelcontextprotocol.io/specification"
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-1 underline hover:text-foreground"
      >
        Model Context Protocol spec <IconExternalLink class="size-3" />
      </a>
    </p>
  </div>
</template>
