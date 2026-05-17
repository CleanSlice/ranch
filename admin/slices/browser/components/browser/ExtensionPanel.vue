<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Input } from '#theme/components/ui/input';
import { Label } from '#theme/components/ui/label';
import { Badge } from '#theme/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';

interface IExtensionTokenResponse {
  token: string;
  exp: number;
}
interface IApiEnvelope<T> {
  success: boolean;
  data: T;
}

const config = useRuntimeConfig();
const auth = useAuthStore();

const agentId = ref('');
const userId = ref(auth.user?.id ?? 'admin');
const ttlDays = ref(30);
const token = ref<string | null>(null);
const tokenExp = ref<number | null>(null);
const issuing = ref(false);
const error = ref<string | null>(null);
const copied = ref(false);

const apiBase = computed(() =>
  String(config.public.apiUrl).replace(/\/+$/, ''),
);

const valid = computed(
  () =>
    agentId.value.trim().length > 0 &&
    userId.value.trim().length > 0 &&
    ttlDays.value >= 1 &&
    ttlDays.value <= 365,
);

const expiresHuman = computed(() => {
  if (!tokenExp.value) return '';
  try {
    return new Date(tokenExp.value * 1000).toLocaleString();
  } catch {
    return '';
  }
});

async function issue() {
  if (!valid.value) return;
  issuing.value = true;
  error.value = null;
  copied.value = false;
  try {
    const res = await fetch(`${apiBase.value}/browser/extension/token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        agentId: agentId.value.trim(),
        userId: userId.value.trim(),
        ttlDays: ttlDays.value,
      }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const env = (await res.json()) as IApiEnvelope<IExtensionTokenResponse>;
    const payload = env.data ?? (env as unknown as IExtensionTokenResponse);
    token.value = payload.token;
    tokenExp.value = payload.exp;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    issuing.value = false;
  }
}

async function copy() {
  if (!token.value) return;
  await navigator.clipboard.writeText(token.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

function revoke() {
  token.value = null;
  tokenExp.value = null;
  copied.value = false;
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="text-lg">Connect via extension</CardTitle>
      <CardDescription>
        Send cookies from your normal Chrome to an agent — without VNC. Use
        when a service (Instagram, PayPal, anything) detects automation and
        won't let the in-pool browser sign in.
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-5">
      <ol class="text-sm space-y-1 list-decimal pl-5 text-muted-foreground">
        <li>
          Install the
          <a
            href="https://github.com/CleanSlice/ranch/tree/main/extension"
            target="_blank"
            class="underline decoration-dotted text-foreground"
          >Ranch Cookies</a>
          extension into your local Chrome (Developer mode → Load unpacked
          → pick <code class="rounded bg-muted px-1 py-0.5 text-xs">ranch/extension/</code>).
        </li>
        <li>Generate a token below — paste it into the extension popup along with this Ranch API URL.</li>
        <li>
          Browse to the site you want the agent to drive, click the
          extension icon, type a profile name (e.g.
          <code class="rounded bg-muted px-1 py-0.5 text-xs">instagram</code>),
          press <strong>Send cookies</strong>.
        </li>
        <li>
          Run
          <code class="rounded bg-muted px-1 py-0.5 text-xs">browser_play(profile: "instagram")</code>
          — the agent runs Chromium with the cookies you just sent, logged
          in.
        </li>
      </ol>

      <div class="grid gap-3 sm:grid-cols-3">
        <div class="flex flex-col gap-2 sm:col-span-2">
          <Label for="ext-agent">Agent ID</Label>
          <Input
            id="ext-agent"
            v-model="agentId"
            placeholder="agent-201838bd-…"
            autocomplete="off"
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="ext-ttl">TTL (days)</Label>
          <Input
            id="ext-ttl"
            v-model.number="ttlDays"
            type="number"
            min="1"
            max="365"
          />
        </div>
        <div class="flex flex-col gap-2 sm:col-span-3">
          <Label for="ext-user">User ID (within agent)</Label>
          <Input
            id="ext-user"
            v-model="userId"
            placeholder="admin, 55212224, …"
            autocomplete="off"
          />
          <p class="text-xs text-muted-foreground">
            Telegram user ID for chat-driven agents, or
            <code class="rounded bg-muted px-1 py-0.5 text-xs">admin</code>
            for the admin agent. Multiple humans can keep separate cookie
            sets inside one agent by using different user IDs.
          </p>
        </div>
      </div>

      <Button :disabled="!valid || issuing" @click="issue">
        {{ issuing ? 'Generating…' : token ? 'Re-generate token' : 'Generate token' }}
      </Button>

      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

      <div v-if="token" class="flex flex-col gap-3 rounded-md border bg-muted/40 p-4">
        <div class="flex items-center justify-between">
          <div class="text-xs text-muted-foreground">
            Extension token
            <span v-if="expiresHuman">
              · expires {{ expiresHuman }}
            </span>
          </div>
          <Badge variant="outline" v-if="copied">Copied!</Badge>
        </div>
        <code class="block break-all text-xs font-mono">{{ token }}</code>
        <div class="flex gap-2">
          <Button size="sm" @click="copy">Copy</Button>
          <Button size="sm" variant="outline" @click="revoke">Clear from view</Button>
        </div>
        <div class="rounded-md border bg-card p-3 text-xs text-muted-foreground">
          Paste into the extension popup under <strong>Connection</strong>:
          <ul class="mt-1 list-disc pl-5">
            <li>
              Ranch API URL:
              <code class="rounded bg-muted px-1 py-0.5">{{ apiBase }}</code>
            </li>
            <li>Bearer token: the value above.</li>
          </ul>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
