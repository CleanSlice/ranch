import { Injectable, Logger } from '@nestjs/common';
import { ISettingGateway } from '#/setting/domain';
import { ISkillSearchHit, ISkillFile } from '../domain';

/**
 * Curated list of public GitHub repositories that publish reusable
 * SKILL.md documents. Each query is fan-out across these repos via the
 * GitHub Code Search API — first matching SKILL.md / README.md wins
 * the "title" slot, the repo URL is recorded as `source` on import.
 *
 * To add a source:
 *   1. Append { repo, label } below.
 *   2. Make sure the repo is public and contains markdown files we can
 *      identify as skills (named SKILL.md, README.md inside a folder
 *      under /skills/, etc.).
 */
const SOURCES: { repo: string; label: string }[] = [
  // Engineering / research
  { repo: 'anthropics/skills', label: 'Anthropic' },
  { repo: 'VoltAgent/awesome-agent-skills', label: 'VoltAgent' },
  { repo: 'supabase/agent-skills', label: 'Supabase' },
  { repo: 'agent0ai/agent-zero', label: 'Agent Zero' },
  { repo: 'Orchestra-Research/AI-research-SKILLs', label: 'AI Research' },
  // Marketing / SMM / ads
  { repo: 'coreyhaines31/marketingskills', label: 'Marketing (Haines)' },
  { repo: 'kostja94/marketing-skills', label: 'Marketing (Kostja)' },
  { repo: 'superamped/ai-marketing-skills', label: 'Marketing (Superamped)' },
  { repo: 'zubair-trabzada/ai-marketing-claude', label: 'Marketing (Trabzada)' },
  { repo: 'alirezarezvani/claude-skills', label: 'Claude Skills (mixed)' },
];

interface GhCodeSearchItem {
  name: string;
  path: string;
  html_url: string;
  repository: { full_name: string; html_url: string };
  text_matches?: { fragment: string }[];
}

@Injectable()
export class GithubSearch {
  private readonly logger = new Logger(GithubSearch.name);

  constructor(private settingGateway: ISettingGateway) {}

  listSources(): { repo: string; label: string }[] {
    return SOURCES;
  }

  async search(query: string): Promise<ISkillSearchHit[]> {
    const token = await this.getToken();
    const trimmed = query.trim();

    const requests = SOURCES.map((s) =>
      this.searchOne(s.repo, trimmed, token).catch((err) => {
        this.logger.warn(`search failed for ${s.repo}: ${(err as Error).message}`);
        return [] as ISkillSearchHit[];
      }),
    );
    const lists = await Promise.all(requests);
    return dedupe(lists.flat());
  }

  /**
   * Fetch a skill bundle from GitHub: the SKILL.md itself plus every
   * sibling file in the same folder (recursively, e.g. `references/*.md`).
   * Binary files and anything bigger than MAX_FILE_BYTES is skipped.
   */
  /**
   * Resolve a GitHub URL into a (repo, path-to-SKILL.md) pair, then
   * fetch the bundle. Accepts:
   *
   *   .../tree/<ref>/<path>           → folder; we look for SKILL.md or README.md
   *   .../blob/<ref>/<path>           → file (must be markdown)
   *   .../raw/<ref>/<path>            → file (raw URL)
   *   raw.githubusercontent.com/...   → file
   *
   * Throws if the URL is not GitHub or the folder has no recognisable skill file.
   */
  async fetchBundleFromUrl(url: string): Promise<{
    repo: string;
    skillPath: string;
    bundle: {
      title: string;
      body: string;
      description: string | null;
      files: ISkillFile[];
    };
  }> {
    const parsed = parseGithubUrl(url);
    if (!parsed) throw new Error(`Not a recognised GitHub URL: ${url}`);
    const { repo, path: rawPath, kind } = parsed;

    const token = await this.getToken();
    let skillPath = rawPath;

    if (kind === 'tree' || rawPath === '' || !rawPath.includes('.')) {
      // Folder: pick SKILL.md if present, else README.md, else first .md
      const sha = await this.getHeadSha(repo, token);
      const tree = await this.getRecursiveTree(repo, sha, token);
      const dirPrefix = rawPath ? `${rawPath}/` : '';
      const candidates = tree.tree.filter(
        (t) => t.type === 'blob' && t.path.startsWith(dirPrefix),
      );
      const inDirOnly = (p: string) =>
        rawPath === ''
          ? !p.includes('/')
          : p.slice(dirPrefix.length).indexOf('/') === -1;

      const skillMd = candidates.find(
        (t) => t.path.endsWith('/SKILL.md') || t.path === 'SKILL.md',
      );
      const directReadme = candidates.find(
        (t) => inDirOnly(t.path) && /README\.md$/i.test(t.path),
      );
      const directFirstMd = candidates.find(
        (t) => inDirOnly(t.path) && /\.md$/i.test(t.path),
      );

      const chosen = skillMd ?? directReadme ?? directFirstMd;
      if (!chosen) {
        throw new Error(
          `No SKILL.md / README.md / *.md found in ${repo}/${rawPath}`,
        );
      }
      skillPath = chosen.path;
    } else {
      // File URL: must be markdown
      if (!/\.md$/i.test(skillPath)) {
        throw new Error(`Expected a .md file URL, got: ${skillPath}`);
      }
    }

    const bundle = await this.fetchBundle(repo, skillPath);
    return { repo, skillPath, bundle };
  }

  async fetchBundle(
    repo: string,
    skillPath: string,
  ): Promise<{
    title: string;
    body: string;
    description: string | null;
    files: ISkillFile[];
  }> {
    const token = await this.getToken();

    // 1. Resolve the repo's HEAD commit SHA.
    const sha = await this.getHeadSha(repo, token);

    // 2. Pull the recursive tree once, then keep only what's under the
    //    skill folder (siblings of SKILL.md).
    const dir = parentDir(skillPath);
    const treeRes = await fetch(
      `https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`,
      { headers: githubHeaders(token) },
    );
    if (!treeRes.ok) {
      throw new Error(`GitHub tree ${treeRes.status} for ${repo}@${sha}`);
    }
    const tree = (await treeRes.json()) as {
      tree: { path: string; type: string; size?: number }[];
      truncated?: boolean;
    };
    const blobs = tree.tree.filter(
      (t) =>
        t.type === 'blob' &&
        (dir === '' ? !t.path.includes('/') : t.path.startsWith(`${dir}/`)),
    );

    // 3. Fetch every blob via raw.githubusercontent (cheap, no rate limit
    //    on the API side; auth header optional for public repos).
    const fetchedAll = await Promise.all(
      blobs.map(async (b) => {
        if ((b.size ?? 0) > MAX_FILE_BYTES) {
          this.logger.debug(`skip ${b.path} — ${b.size} bytes > ${MAX_FILE_BYTES}`);
          return null;
        }
        if (!isLikelyText(b.path)) return null;
        const raw = await fetch(
          `https://raw.githubusercontent.com/${repo}/${sha}/${b.path}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
        );
        if (!raw.ok) {
          this.logger.warn(`raw fetch ${raw.status} for ${b.path}`);
          return null;
        }
        return { path: b.path, content: await raw.text() };
      }),
    );
    const fetched = fetchedAll.filter((x): x is { path: string; content: string } => x !== null);

    const skillEntry = fetched.find((f) => f.path === skillPath);
    if (!skillEntry) {
      throw new Error(`SKILL file not found at ${skillPath} in ${repo}`);
    }
    const meta = parseSkillMetadata(skillEntry.content, skillPath);

    // Strip the parent-dir prefix so files use paths relative to the skill root.
    const stripPrefix = (p: string) => (dir === '' ? p : p.slice(dir.length + 1));
    const siblings: ISkillFile[] = fetched
      .filter((f) => f.path !== skillPath)
      .map((f) => ({ path: stripPrefix(f.path), content: f.content }));

    return {
      title: meta.title,
      body: skillEntry.content,
      description: meta.description,
      files: siblings,
    };
  }

  private async getRecursiveTree(
    repo: string,
    sha: string,
    token: string | null,
  ): Promise<{ tree: { path: string; type: string; size?: number }[] }> {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`,
      { headers: githubHeaders(token) },
    );
    if (!res.ok) throw new Error(`GitHub tree ${res.status} for ${repo}@${sha}`);
    return res.json() as Promise<{
      tree: { path: string; type: string; size?: number }[];
    }>;
  }

  private async getHeadSha(repo: string, token: string | null): Promise<string> {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/commits/HEAD`,
      { headers: githubHeaders(token) },
    );
    if (!res.ok) throw new Error(`GitHub commits/HEAD ${res.status} for ${repo}`);
    const data = (await res.json()) as { sha: string };
    return data.sha;
  }

  // ── internals ───────────────────────────────────────────────────────

  private async searchOne(
    repo: string,
    query: string,
    token: string | null,
  ): Promise<ISkillSearchHit[]> {
    // Find SKILL.md files in this repo that match the query.
    // Code Search needs auth — without it we get 422 on every call.
    if (!token) return [];
    const q = `${query} repo:${repo} filename:SKILL extension:md`;
    const url = `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=10`;
    const res = await fetch(url, { headers: githubHeaders(token, true) });
    if (!res.ok) {
      throw new Error(`GitHub search ${res.status} for ${repo}`);
    }
    const data = (await res.json()) as { items?: GhCodeSearchItem[] };
    return (data.items ?? []).map((item) => toHit(item));
  }

  private async getToken(): Promise<string | null> {
    const setting = await this.settingGateway.findByKey(
      'integrations',
      'github_pat',
    );
    const value = typeof setting?.value === 'string' ? setting.value : '';
    return value || process.env.GITHUB_TOKEN || null;
  }
}

function githubHeaders(token: string | null, withTextMatches = false): Record<string, string> {
  const h: Record<string, string> = {
    Accept: withTextMatches
      ? 'application/vnd.github.text-match+json'
      : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ranch-skill-search',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function toHit(item: GhCodeSearchItem): ISkillSearchHit {
  const repo = item.repository.full_name;
  const slug = guessSlug(item.path);
  const title = humanize(slug);
  return {
    source: `github:${repo}`,
    repo,
    path: item.path,
    name: slug,
    title,
    description: null,
    url: item.html_url,
    snippet: item.text_matches?.[0]?.fragment ?? null,
  };
}

function guessSlug(path: string): string {
  // path is usually `<dir>/.../SKILL.md` — take parent folder name.
  const parts = path.split('/').filter(Boolean);
  const fname = parts.pop() ?? '';
  const parent = parts.pop();
  const raw = parent && parent !== 'skills' ? parent : fname.replace(/\.md$/i, '');
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'skill';
}

function humanize(slug: string): string {
  return slug
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

// Cap each individual file at 256 KiB; the sum of body + files is bounded
// by ConfigMap's 1 MiB limit, so we leave plenty of headroom for a few of them.
const MAX_FILE_BYTES = 256 * 1024;

/**
 * Parse a GitHub URL into { repo, path, kind }. Returns null if not GitHub.
 * Supports tree/blob/raw forms on github.com plus raw.githubusercontent.com.
 */
export function parseGithubUrl(input: string): {
  repo: string;
  path: string;
  kind: 'tree' | 'blob';
} | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split('/').filter(Boolean);

  if (host === 'raw.githubusercontent.com') {
    // /<owner>/<repo>/<ref>/<...path>
    if (segs.length < 4) return null;
    const [owner, repo, , ...rest] = segs;
    return { repo: `${owner}/${repo}`, path: rest.join('/'), kind: 'blob' };
  }
  if (host !== 'github.com' && host !== 'www.github.com') return null;

  // /<owner>/<repo> (no path) → root folder
  if (segs.length < 2) return null;
  const [owner, repo, type, , ...rest] = segs;
  if (segs.length === 2) {
    return { repo: `${owner}/${repo}`, path: '', kind: 'tree' };
  }
  if (type !== 'tree' && type !== 'blob' && type !== 'raw') return null;
  // segs[3] is the ref (branch/sha/tag) — we always resolve from HEAD anyway,
  // so we ignore it. Anything beyond is the in-repo path.
  return {
    repo: `${owner}/${repo}`,
    path: rest.join('/'),
    kind: type === 'tree' ? 'tree' : 'blob',
  };
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? '' : path.slice(0, idx);
}

function isLikelyText(path: string): boolean {
  // Permissive allowlist — anything markdown/code/config/data we'd plausibly
  // want a skill author to ship. Excludes binaries (images, archives, …).
  return /\.(md|mdx|markdown|txt|rst|adoc|json|yaml|yml|toml|ini|cfg|conf|env|properties|html|xml|svg|csv|tsv|sql|sh|bash|zsh|py|rb|go|rs|java|kt|ts|tsx|js|jsx|mjs|cjs|c|h|cc|hh|cpp|hpp|cs|php|pl|swift|scala|lua|r|jl|tex|gitignore|editorconfig|prettierrc|eslintrc|dockerignore|dockerfile)$/i.test(
    path,
  ) || /^(Dockerfile|Makefile|README|LICENSE)/.test(path.split('/').pop() ?? '');
}

function dedupe(hits: ISkillSearchHit[]): ISkillSearchHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    const k = `${h.repo}:${h.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

interface SkillMeta {
  title: string;
  description: string | null;
}

function parseSkillMetadata(body: string, path: string): SkillMeta {
  // YAML front-matter — only handle `name`, `title`, `description` keys.
  const fm = body.match(/^---\s*\n([\s\S]*?)\n---/);
  let fmTitle: string | null = null;
  let fmDescription: string | null = null;
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w+)\s*:\s*(.+)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (key === 'title' || key === 'name') fmTitle ??= val;
      if (key === 'description') fmDescription ??= val;
    }
  }
  // Fallback: first H1 heading
  const h1 = body.match(/^#\s+(.+)$/m);
  const slug = guessSlug(path);
  const title = fmTitle ?? h1?.[1]?.trim() ?? humanize(slug);
  return { title, description: fmDescription };
}
