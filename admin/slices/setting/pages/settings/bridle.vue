<script setup lang="ts">
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';

const fields = [
  {
    group: 'integrations',
    name: 'bridle_url',
    label: 'Bridle URL',
    placeholder: 'http://host.k3d.internal:3333/ws/agent',
  },
  {
    group: 'integrations',
    name: 'bridle_api_key',
    label: 'Bridle API key',
    type: 'password' as const,
    placeholder: 'matches BRIDLE_API_KEY in api/.env',
    description:
      'Shared secret agents send on the /ws/agent handshake. NOT used by browser embed widgets — those are gated by JWT_SECRET (see below).',
  },
];

const apiUrl = useRuntimeConfig().public.apiUrl as string;
</script>

<template>
  <div class="flex flex-col gap-6">
    <SettingForm
      title="Bridle chat hub — agent auth"
      description="Agents connect to this URL on startup. Must include the /ws/agent namespace. Empty = default http://host.k3d.internal:3333/ws/agent (local k3d reaching host api)."
      :fields="fields"
    />

    <Card>
      <CardHeader>
        <CardTitle>Browser embed widgets — how to get a JWT</CardTitle>
        <CardDescription>
          Embedded chat widgets (the <code class="rounded bg-muted px-1 py-0.5 text-xs">&lt;script&gt;</code>
          drop-in from <code class="rounded bg-muted px-1 py-0.5 text-xs">@cleanslice/bridle</code>) authenticate the
          <em>browser</em> with a short-lived JWT. The recommended path is to call Ranch directly using an
          <NuxtLink to="/api-keys" class="font-medium underline hover:text-foreground">API key</NuxtLink>
          — your backend never holds <code class="rounded bg-muted px-1 py-0.5 text-xs">JWT_SECRET</code>.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-6 text-sm">
        <section>
          <h4 class="mb-1 font-medium">Option 1 — Public agent, no token</h4>
          <p class="mb-2 text-muted-foreground">
            Easiest path for marketing pages. Mark the agent
            <code class="rounded bg-muted px-1 py-0.5 text-xs">isPublic: true</code> and add the embedding origin to its
            <code class="rounded bg-muted px-1 py-0.5 text-xs">allowedOrigins</code>; then drop
            <code class="rounded bg-muted px-1 py-0.5 text-xs">data-token</code> from the snippet. The hub gives the visitor an
            <code class="rounded bg-muted px-1 py-0.5 text-xs">anon-*</code> session.
          </p>
<pre class="overflow-x-auto rounded-md bg-muted p-3 text-xs"><code>&lt;script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-api-url="{{ apiUrl }}"
  data-agent-id="agent-..."
&gt;&lt;/script&gt;</code></pre>
        </section>

        <section>
          <h4 class="mb-1 font-medium">Option 2 — Call Ranch with an API key (recommended)</h4>
          <p class="mb-2 text-muted-foreground">
            Create a key in
            <NuxtLink to="/api-keys" class="font-medium underline hover:text-foreground">Settings &rarr; API Keys</NuxtLink>
            with the
            <code class="rounded bg-muted px-1 py-0.5 text-xs">embed:mint</code> scope. Your backend forwards the key to
            <code class="rounded bg-muted px-1 py-0.5 text-xs">POST /auth/embed/token</code>; Ranch returns a 15-minute JWT for
            <code class="rounded bg-muted px-1 py-0.5 text-xs">data-token</code>. <strong>Owner / Admin roles are stripped server-side</strong>,
            so a leaked embed key cannot impersonate platform admins. Revoke any key from the list with one click.
          </p>
<pre class="overflow-x-auto rounded-md bg-muted p-3 text-xs"><code>// your backend (node)
const r = await fetch('{{ apiUrl }}/auth/embed/token', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.RANCH_EMBED_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    sub: 'user-123',                // visitor's id in your system — used as clientId in the bridle hub
    email: 'alice@example.com',     // optional, surfaces in agent logs
  }),
});
const { token } = await r.json();   // hand to the browser, plug into data-token</code></pre>
        </section>

        <section>
          <h4 class="mb-1 font-medium">Option 3 — Forward an existing Ranch user JWT</h4>
          <p class="text-muted-foreground">
            If the embedding page already authenticates users against Ranch, the
            <code class="rounded bg-muted px-1 py-0.5 text-xs">accessToken</code> returned by
            <code class="rounded bg-muted px-1 py-0.5 text-xs">POST /auth/login</code> is already a valid embed token —
            no extra signing step. The hub identifies the visitor from the same JWT.
          </p>
        </section>

        <section>
          <h4 class="mb-1 font-medium">JWT payload reference</h4>
          <ul class="list-disc space-y-1 pl-5 text-muted-foreground">
            <li><code class="rounded bg-muted px-1 py-0.5 text-xs">sub</code> — used as <code class="rounded bg-muted px-1 py-0.5 text-xs">clientId</code> for routing</li>
            <li><code class="rounded bg-muted px-1 py-0.5 text-xs">email</code> — surfaced in agent logs</li>
            <li><code class="rounded bg-muted px-1 py-0.5 text-xs">roles</code> — array; the embed-mint endpoint strips <code class="rounded bg-muted px-1 py-0.5 text-xs">Owner</code>/<code class="rounded bg-muted px-1 py-0.5 text-xs">Admin</code> server-side</li>
            <li><code class="rounded bg-muted px-1 py-0.5 text-xs">exp</code> — keep short (≤15m); browsers can re-fetch on expiry by passing a function to the SDK's <code class="rounded bg-muted px-1 py-0.5 text-xs">token</code> option</li>
          </ul>
        </section>
      </CardContent>
    </Card>
  </div>
</template>
