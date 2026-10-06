<script setup lang="ts">
/**
 * What a sender has to send, in the console where the owner creates its key —
 * so DevOps can wire one from this page and an API key, without asking the
 * development team. The long form is docs/operations/agent-events.md.
 */
const runtime = useRuntimeConfig();
const endpoint = computed(
  () => `${String(runtime.public.apiUrl ?? '').replace(/\/+$/, '')}/agent-events`,
);

const FIELDS: readonly { name: string; required: boolean; meaning: string }[] = [
  {
    name: 'agentId',
    required: true,
    meaning:
      'The agent’s id. On its pod: the label ranch/agent-id (the pod is agent-<agentId>, namespace agents).',
  },
  { name: 'status', required: true, meaning: 'failed or recovered.' },
  {
    name: 'datetime',
    required: false,
    meaning: 'When it happened, ISO 8601. Left out: the time Ranch received it.',
  },
  {
    name: 'reason',
    required: false,
    meaning: 'The cause in the cluster’s own words. Shown as sent.',
  },
  {
    name: 'source',
    required: false,
    meaning: 'The tool that noticed. Detail only — the sender is the key.',
  },
  {
    name: 'eventId',
    required: false,
    meaning: 'Your id for the event. Makes a retry safe: stored once.',
  },
];

const curl = computed(
  () =>
    `curl -sS -X POST "${endpoint.value}" \\\n` +
    `  -H "Authorization: Bearer $RANCH_EVENTS_KEY" \\\n` +
    `  -H "Content-Type: application/json" \\\n` +
    `  -d '{"agentId":"<agent id>","status":"failed","reason":"OOMKilled","source":"curl"}'`,
);
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Senders</CardTitle>
      <CardDescription>
        Cluster tooling can report an agent failure to Ranch. An event from
        outside is a second witness beside Ranch’s own watch: it is recorded
        and may notify the team, and it never changes an agent’s status.
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4 text-sm">
      <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
        <dt class="text-muted-foreground">Address</dt>
        <dd>
          <code class="break-all">POST {{ endpoint }}</code>
        </dd>
        <dt class="text-muted-foreground">Key</dt>
        <dd>
          An API key with the single scope <code>events:write</code> —
          <NuxtLink to="/api-keys" class="underline">create one under API keys</NuxtLink>.
          It can post events and nothing else. One key per sender: its name is
          shown as the sender.
        </dd>
        <dt class="text-muted-foreground">Answer</dt>
        <dd>
          Any <code>2xx</code> means Ranch has it — do not retry.
          <code>429</code> carries <code>Retry-After</code> (60 events a minute
          per key).
        </dd>
      </dl>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Field</TableHead>
            <TableHead>Required</TableHead>
            <TableHead>Meaning</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="field in FIELDS" :key="field.name">
            <TableCell class="align-top">
              <code>{{ field.name }}</code>
            </TableCell>
            <TableCell class="align-top">{{ field.required ? 'yes' : 'no' }}</TableCell>
            <TableCell class="whitespace-normal">{{ field.meaning }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <pre class="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs"><code>{{ curl }}</code></pre>

      <ul class="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>
          Sending <code>failed</code> alone is enough: an incident closes when
          Ranch has seen the agent running for ten quiet minutes.
        </li>
        <li>
          Repeats are harmless, and restarts need no filtering — an event
          about an agent a person stopped or is restarting notifies nobody.
        </li>
        <li>
          If Ranch itself is down this address is down too: send “the platform
          is degraded” to the chat by a path that does not pass through Ranch.
        </li>
      </ul>
    </CardContent>
  </Card>
</template>
