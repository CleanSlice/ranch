import { IIntegrationCatalogueItem } from './integration.types';

// Static catalogue. Order here drives display order in the admin UI.
// Adding a new service: append a row, then add a skill that teaches the
// agent how to use it. No DB migration required.
export const INTEGRATION_CATALOGUE: IIntegrationCatalogueItem[] = [
  {
    service: 'instagram',
    title: 'Instagram',
    description:
      'Browse profiles, read DMs, post or schedule content via a real Chrome session — cookies survive pod restarts on the browser-pool PVC.',
    iconUrl: '/icons/integrations/instagram.svg',
    mechanism: 'browser',
    loginUrl: 'https://www.instagram.com/accounts/login/',
    accountKeyHint: 'Your Instagram handle, e.g. "miybot"',
    domains: ['instagram.com'],
  },
  {
    service: 'facebook',
    title: 'Facebook / Meta Ads',
    description:
      'Manage Facebook pages and Meta Ads campaigns through a logged-in browser session. Uses the same Meta cookies as Instagram when accounts are linked.',
    iconUrl: '/icons/integrations/facebook.svg',
    mechanism: 'browser',
    loginUrl: 'https://www.facebook.com/login/',
    accountKeyHint: 'Label for this Facebook account, e.g. "main" or page name',
    domains: ['facebook.com', 'business.facebook.com', 'adsmanager.facebook.com'],
  },
  {
    service: 'tiktok',
    title: 'TikTok',
    description:
      'Read trending content, schedule posts, and pull analytics via a logged-in TikTok session.',
    iconUrl: '/icons/integrations/tiktok.svg',
    mechanism: 'browser',
    loginUrl: 'https://www.tiktok.com/login',
    accountKeyHint: 'Your TikTok username',
    domains: ['tiktok.com'],
  },
  {
    service: 'x',
    title: 'X (Twitter)',
    description:
      'Post, reply, and read timelines on X via a logged-in session. Works with both personal and business profiles.',
    iconUrl: '/icons/integrations/x.svg',
    mechanism: 'browser',
    loginUrl: 'https://x.com/i/flow/login',
    accountKeyHint: 'Your X handle without the @',
    domains: ['x.com', 'twitter.com'],
  },
  {
    service: 'openai',
    title: 'OpenAI',
    description:
      'Stored as an environment secret. Agents see it as OPENAI_API_KEY when running tools that hit the OpenAI API.',
    iconUrl: '/icons/integrations/openai.svg',
    mechanism: 'secret',
    secretEnvKey: 'OPENAI_API_KEY',
    secretHelp: 'Create one at platform.openai.com/api-keys (starts with sk-…)',
  },
  {
    service: 'github',
    title: 'GitHub',
    description:
      'Personal access token used for repo operations, issues, PRs, and the GitHub MCP server.',
    iconUrl: '/icons/integrations/github.svg',
    mechanism: 'secret',
    secretEnvKey: 'GITHUB_TOKEN',
    secretHelp:
      'github.com/settings/tokens — fine-grained tokens recommended. Scopes: repo + read:user.',
  },
  {
    service: 'stripe',
    title: 'Stripe',
    description:
      'Restricted or secret API key. Agents see it as STRIPE_API_KEY for charges, refunds, and customer lookups.',
    iconUrl: '/icons/integrations/stripe.svg',
    mechanism: 'secret',
    secretEnvKey: 'STRIPE_API_KEY',
    secretHelp:
      'dashboard.stripe.com/apikeys — prefer a restricted key with only the scopes the agent needs (starts with sk_live_… or sk_test_…)',
  },
];

export function findCatalogueItem(
  service: string,
): IIntegrationCatalogueItem | undefined {
  return INTEGRATION_CATALOGUE.find((item) => item.service === service);
}
