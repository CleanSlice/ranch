import {
  callbackPageCsp,
  escapeHtml,
  renderCallbackPage,
} from './callbackPage';

/**
 * The callback page is the one place a provider-chosen string (the server
 * name, an error echoed back from the token exchange) meets raw HTML. These
 * pin the two guarantees: nothing interpolated survives as markup, and the
 * CSP only admits the page's own nonce-tagged script.
 */
describe('escapeHtml', () => {
  it('neutralizes every character that can open markup or an attribute', () => {
    expect(escapeHtml(`<b onclick="x">&'`)).toBe(
      '&lt;b onclick=&quot;x&quot;&gt;&amp;&#39;',
    );
  });

  it('leaves ordinary text, emoji included, untouched', () => {
    expect(escapeHtml('Connected to Silpo ✅')).toBe('Connected to Silpo ✅');
  });
});

describe('renderCallbackPage', () => {
  const nonce = 'abc123';

  it('renders a script tag from a heading that tried to inject one as text', () => {
    const html = renderCallbackPage({
      heading: 'Connected to <script>alert(1)</script> ✅',
      sub: 'You can return to the chat.',
      nonce,
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('keeps an error echoed by the provider from breaking out of its paragraph', () => {
    const html = renderCallbackPage({
      heading: 'Connection failed',
      sub: `"><img src=x onerror=alert('x')>`,
      nonce,
    });

    expect(html).not.toContain('<img');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(&#39;x&#39;)&gt;');
  });

  it('tags its own close-window script with the response nonce', () => {
    const html = renderCallbackPage({
      heading: 'Connected ✅',
      sub: 'You can return to the chat.',
      nonce,
    });

    expect(html).toContain(`<script nonce="${nonce}">`);
    // Exactly one script on the page — the one the CSP admits.
    expect(html.match(/<script/g)).toHaveLength(1);
  });
});

describe('callbackPageCsp', () => {
  it('admits only the nonce-tagged script and inline styles', () => {
    const csp = callbackPageCsp('abc123');

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-abc123'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
