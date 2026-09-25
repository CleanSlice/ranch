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

/**
 * Going back on its own (CLEAN-120): the page a person lands on after the
 * provider login returns them to the chat by three means — a meta refresh
 * for browsers with scripts off, a countdown script, and a button — and
 * only when the service handed it a checked address.
 */
describe('renderCallbackPage — returning to the chat', () => {
  const nonce = 'abc123';
  const returnTo = 'https://admin.ranch.test/agents/agent-1';

  it('offers the meta refresh, the countdown and the button when a return address exists', () => {
    const html = renderCallbackPage({ heading: 'Connected ✅', sub: 'Your account is linked.', nonce, returnTo });

    expect(html).toContain(`<meta http-equiv="refresh" content="5;url=${returnTo}">`);
    expect(html).toContain('Returning to the chat in <span id="s">5</span> seconds');
    expect(html).toContain(`<a href="${returnTo}"`);
    expect(html).toContain('Back to chat');
    expect(html).toContain('location.replace("https://admin.ranch.test/agents/agent-1")');
    expect(html).not.toContain('window.close()');
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it('keeps the plain page when there is nowhere to go', () => {
    const html = renderCallbackPage({ heading: 'Connected ✅', sub: 'You can return to the chat.', nonce, returnTo: null });
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).not.toContain('Back to chat');
    expect(html).toContain('window.close()');
  });

  it('cannot be broken out of by the return address', () => {
    const html = renderCallbackPage({
      heading: 'x',
      sub: 'y',
      nonce,
      returnTo: 'https://admin.ranch.test/agents/a"><script>alert(1)</script><b</script>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('</script><b</script>');
    expect(html.match(/<script/g)).toHaveLength(1);
  });
});
