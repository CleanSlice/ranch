// @scope:api
// @slice:reins/source
// @layer:data
// @type:utility

// Walks a sitemap.xml (or sitemap-index) and returns the list of page URLs
// it covers. sitemapindex entries are fetched recursively up to MAX_DEPTH.
// We parse with a regex over <loc>…</loc> rather than a full XML parser
// because the sitemap protocol is very narrow (urlset / sitemapindex,
// <loc> always populated, no namespaces that matter for extraction) and
// avoiding a new dependency keeps the bundle slim. CDATA-wrapped URLs are
// uncommon for sitemaps and a no-op for this regex would be tolerable
// because filter / ingest will skip empty strings.

const SITEMAP_FETCH_TIMEOUT_MS = 10_000;
// Maximum nesting depth for sitemap-index recursion. 3 covers
// index → child-index → child-sitemap, which is deeper than any realistic
// site needs.
const MAX_DEPTH = 3;
// Hard cap to prevent an accidental crawl of a 100k-page site from queuing
// up tens of thousands of LightRAG ingests. Larger jobs should be split.
const MAX_URLS = 1_000;

export class SitemapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SitemapError';
  }
}

export interface FetchSitemapOptions {
  urlPrefix?: string;
  fetchImpl?: typeof fetch;
}

export async function fetchSitemapUrls(
  sitemapUrl: string,
  options: FetchSitemapOptions = {},
): Promise<string[]> {
  const fetcher = options.fetchImpl ?? fetch;
  const collected: string[] = [];
  const seenSitemaps = new Set<string>();

  async function walk(url: string, depth: number): Promise<void> {
    if (depth >= MAX_DEPTH) {
      throw new SitemapError(
        `sitemap nesting exceeds depth ${MAX_DEPTH} (at ${url})`,
      );
    }
    if (seenSitemaps.has(url)) return;
    seenSitemaps.add(url);

    const xml = await fetchXml(fetcher, url);
    const locs = extractLocs(xml);

    if (isSitemapIndex(xml)) {
      for (const nested of locs) {
        if (collected.length >= MAX_URLS) return;
        await walk(nested, depth + 1);
      }
      return;
    }

    // Treat zero <loc> entries on a non-index document as a strong hint the
    // server returned HTML (SPA shell, login wall, captive portal) instead
    // of a real sitemap. Otherwise the user just sees "Added 0 of 0" with
    // no clue why.
    if (locs.length === 0) {
      throw new SitemapError(
        `no <loc> entries found at ${url} - is this really a sitemap?`,
      );
    }

    for (const pageUrl of locs) {
      if (collected.length >= MAX_URLS) return;
      if (options.urlPrefix && !pageUrl.startsWith(options.urlPrefix)) {
        continue;
      }
      collected.push(pageUrl);
    }
  }

  await walk(sitemapUrl, 0);
  return collected;
}

async function fetchXml(
  fetcher: typeof fetch,
  url: string,
): Promise<string> {
  let res: Response;
  try {
    res = await fetcher(url, {
      signal: AbortSignal.timeout(SITEMAP_FETCH_TIMEOUT_MS),
      headers: { accept: 'application/xml, text/xml, */*' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new SitemapError(`fetch failed for ${url}: ${message}`);
  }
  if (!res.ok) {
    throw new SitemapError(`fetch failed for ${url}: HTTP ${res.status}`);
  }
  return await res.text();
}

// A document is treated as a sitemap-index iff it contains a <sitemapindex>
// root element. Anything else (urlset, malformed, or just a different XML
// shape) is parsed as a flat list of <loc> entries pointing at pages.
function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex\b/i.test(xml);
}

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*(?:<!\[CDATA\[([^\]]+)\]\]>|([^<]+))\s*<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = (m[1] ?? m[2] ?? '').trim();
    if (raw.length > 0) out.push(decodeXmlEntities(raw));
  }
  return out;
}

// The sitemap protocol mandates entity-escaping of `&`, `<`, `>`, `'`, `"`
// inside <loc>. Without this, a real URL like
// `https://example.com/a?x=1&y=2` arrives as `...&amp;y=2` and gets stored
// verbatim, breaking downstream fetches. `&amp;` is decoded last to avoid
// double-decoding chains like `&amp;lt;` -> `<`.
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}
