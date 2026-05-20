<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import { IconCheck, IconAlertCircle, IconRefresh } from '@tabler/icons-vue';

interface IGithubUser {
  login: string;
  id: number;
  name?: string | null;
  email?: string | null;
  type: string;
  plan?: { name: string } | null;
}

interface ICheckResult {
  ok: boolean;
  status: number;
  user?: IGithubUser;
  scopes?: string[];
  rateLimit?: { remaining: number; limit: number; resetAt: string };
  error?: string;
  usernameMatches?: boolean;
}

const settingStore = useSettingStore();

// Fetch settings once so the button knows whether the PAT exists. If the
// form was just edited but not saved, the user has to Save first — we
// don't reach into the form's local refs from here.
await useAsyncData('admin-settings-github-check', () =>
  settingStore.fetchAll(),
);

const pat = computed(() => {
  const v = settingStore.get('integrations', 'github_pat')?.value;
  return typeof v === 'string' ? v.trim() : '';
});
const expectedUsername = computed(() => {
  const v = settingStore.get('integrations', 'github_username')?.value;
  return typeof v === 'string' ? v.trim() : '';
});

const checking = ref(false);
const result = ref<ICheckResult | null>(null);

async function runCheck() {
  if (!pat.value) {
    result.value = {
      ok: false,
      status: 0,
      error:
        'No GitHub PAT saved yet. Fill the field above and click Save changes first.',
    };
    return;
  }

  checking.value = true;
  result.value = null;
  try {
    // Direct call — GitHub allows CORS from any origin when authenticated
    // with a token in the Authorization header. Avoids a server-side proxy
    // and keeps the PAT off ranch-api logs.
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${pat.value}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    // Scopes only on classic PATs — fine-grained tokens don't expose them
    // and the header is empty. We still surface what we get.
    const scopesHeader = res.headers.get('x-oauth-scopes') ?? '';
    const scopes = scopesHeader
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? '0');
    const limit = Number(res.headers.get('x-ratelimit-limit') ?? '0');
    const reset = Number(res.headers.get('x-ratelimit-reset') ?? '0');

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      result.value = {
        ok: false,
        status: res.status,
        error: body.message ?? `HTTP ${res.status}`,
        rateLimit: limit
          ? { remaining, limit, resetAt: new Date(reset * 1000).toLocaleTimeString() }
          : undefined,
      };
      return;
    }

    const user = (await res.json()) as IGithubUser;
    result.value = {
      ok: true,
      status: res.status,
      user,
      scopes,
      rateLimit: limit
        ? { remaining, limit, resetAt: new Date(reset * 1000).toLocaleTimeString() }
        : undefined,
      // Compare exposed login vs the stored username so a mismatched
      // pairing (PAT belongs to a different account) doesn't get
      // silently saved.
      usernameMatches: expectedUsername.value
        ? expectedUsername.value.toLowerCase() === user.login.toLowerCase()
        : true,
    };
  } catch (err) {
    result.value = {
      ok: false,
      status: 0,
      error: (err as Error).message,
    };
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Health check</CardTitle>
      <CardDescription>
        Validate the saved PAT by hitting
        <code>GET https://api.github.com/user</code> directly from the browser.
        The token never leaves this tab.
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <div class="flex items-center gap-3">
        <Button :disabled="checking" @click="runCheck">
          <IconRefresh class="size-4" :class="checking ? 'animate-spin' : ''" />
          {{ checking ? 'Checking…' : 'Check GitHub status' }}
        </Button>
        <span v-if="!pat" class="text-xs text-muted-foreground">
          Save a PAT above first.
        </span>
      </div>

      <div
        v-if="result?.ok"
        class="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm"
      >
        <div class="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
          <IconCheck class="size-4" />
          Connected as
          <a
            class="underline"
            :href="`https://github.com/${result.user!.login}`"
            target="_blank"
            rel="noopener"
            >@{{ result.user!.login }}</a
          >
          <Badge variant="outline" class="text-xs">
            {{ result.user!.type }}
          </Badge>
          <Badge
            v-if="result.user!.plan?.name"
            variant="outline"
            class="text-xs"
          >
            {{ result.user!.plan.name }}
          </Badge>
        </div>
        <dl class="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
          <dt class="text-muted-foreground">Account ID</dt>
          <dd>{{ result.user!.id }}</dd>
          <template v-if="result.user!.name">
            <dt class="text-muted-foreground">Display name</dt>
            <dd>{{ result.user!.name }}</dd>
          </template>
          <template v-if="result.user!.email">
            <dt class="text-muted-foreground">Email</dt>
            <dd>{{ result.user!.email }}</dd>
          </template>
          <template v-if="result.scopes && result.scopes.length">
            <dt class="text-muted-foreground">Token scopes</dt>
            <dd class="font-mono text-[11px]">{{ result.scopes.join(', ') }}</dd>
          </template>
          <template v-else>
            <dt class="text-muted-foreground">Token scopes</dt>
            <dd class="text-muted-foreground">
              none reported — likely a fine-grained PAT (permissions don't surface as scopes)
            </dd>
          </template>
          <template v-if="result.rateLimit">
            <dt class="text-muted-foreground">Rate limit</dt>
            <dd>
              {{ result.rateLimit.remaining }} / {{ result.rateLimit.limit }} ·
              resets at {{ result.rateLimit.resetAt }}
            </dd>
          </template>
        </dl>
        <p
          v-if="result.usernameMatches === false"
          class="mt-3 rounded border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
        >
          ⚠ Stored <code>github_username</code> doesn't match the token owner.
          Saved as <code>{{ expectedUsername }}</code>, token belongs to
          <code>{{ result.user!.login }}</code>.
        </p>
      </div>

      <div
        v-else-if="result"
        class="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"
      >
        <div class="flex items-center gap-2 font-medium text-destructive">
          <IconAlertCircle class="size-4" />
          {{
            result.status === 401
              ? 'Bad credentials'
              : result.status === 403
                ? 'Forbidden (rate limited or token revoked)'
                : result.status === 0
                  ? 'Network / browser error'
                  : `HTTP ${result.status}`
          }}
        </div>
        <p class="mt-2 text-xs text-muted-foreground">{{ result.error }}</p>
        <p
          v-if="result.rateLimit"
          class="mt-2 text-xs text-muted-foreground"
        >
          Rate limit: {{ result.rateLimit.remaining }} /
          {{ result.rateLimit.limit }}, resets at
          {{ result.rateLimit.resetAt }}
        </p>
      </div>
    </CardContent>
  </Card>
</template>
