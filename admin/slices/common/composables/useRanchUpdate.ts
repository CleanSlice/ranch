const REPO = 'CleanSlice/Ranch';
const STORAGE_KEY = 'ranch:updateCheck';
const CACHE_TTL_MS = 60 * 60 * 1000;

interface UpdateState {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  releaseUrl: string | null;
  loading: boolean;
}

interface CachedCheck {
  latest: string;
  releaseUrl: string;
  checkedAt: number;
}

function normalizeVersion(v: string): string {
  // "0.0.0-81bfb09" → "0.0.0" so SHA-suffix builds compare as the lowest
  // semver. Anything else passes through unchanged.
  const dash = v.indexOf('-');
  return dash === -1 ? v : v.slice(0, dash);
}

function parseSemver(v: string): [number, number, number] | null {
  const m = normalizeVersion(v).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const a = m[1];
  const b = m[2];
  const c = m[3];
  if (a === undefined || b === undefined || c === undefined) return null;
  return [Number(a), Number(b), Number(c)];
}

function isNewer(latest: string, current: string): boolean {
  const pl = parseSemver(latest);
  const pc = parseSemver(current);
  if (!pl || !pc) return false;
  if (pl[0] !== pc[0]) return pl[0] > pc[0];
  if (pl[1] !== pc[1]) return pl[1] > pc[1];
  return pl[2] > pc[2];
}

function readCache(): CachedCheck | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedCheck;
    if (Date.now() - parsed.checkedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(entry: CachedCheck): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage may be full / blocked — silently ignore
  }
}

export function useRanchUpdate() {
  const current = useRuntimeConfig().public.ranchVersion as string;

  const state = useState<UpdateState>('ranchUpdate', () => ({
    current,
    latest: null,
    hasUpdate: false,
    releaseUrl: null,
    loading: false,
  }));

  async function check(force = false): Promise<void> {
    if (state.value.loading) return;

    if (!force) {
      const cached = readCache();
      if (cached) {
        state.value.latest = cached.latest;
        state.value.releaseUrl = cached.releaseUrl;
        state.value.hasUpdate = isNewer(cached.latest, current);
        return;
      }
    }

    state.value.loading = true;
    try {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/releases/latest`,
        { headers: { Accept: 'application/vnd.github+json' } },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        tag_name?: string;
        html_url?: string;
      };
      const tag = data.tag_name;
      const url = data.html_url;
      if (!tag || !url || !tag.startsWith('v')) return;
      const latest = tag.slice(1);
      state.value.latest = latest;
      state.value.releaseUrl = url;
      state.value.hasUpdate = isNewer(latest, current);
      writeCache({ latest, releaseUrl: url, checkedAt: Date.now() });
    } catch {
      // network down / CORS / rate limit — silent
    } finally {
      state.value.loading = false;
    }
  }

  return { state: readonly(state), check };
}
