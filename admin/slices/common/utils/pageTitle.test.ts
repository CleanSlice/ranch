import { describe, expect, test } from 'bun:test';
import { pageTitle } from './pageTitle';

const sections = [
  { link: 'templates', title: 'Templates' },
  { link: 'agents', title: 'Agents' },
  { link: 'api', title: 'API' },
  { link: 'api-keys', title: 'API Keys' },
  { link: 'mcps', title: 'MCP servers' },
];

describe('pageTitle', () => {
  test('a section page reads as the section', () => {
    expect(pageTitle('templates', sections)).toBe('Templates');
    expect(pageTitle('mcps', sections)).toBe('MCP servers');
  });

  test('a page inside a section reads as the section, not the route name', () => {
    expect(pageTitle('templates-id', sections)).toBe('Templates');
    expect(pageTitle('templates-id-edit', sections)).toBe('Templates');
    expect(pageTitle('agents-id-paddock', sections)).toBe('Agents');
  });

  test('the longest matching link wins', () => {
    expect(pageTitle('api-keys', sections)).toBe('API Keys');
    expect(pageTitle('api-docs', sections)).toBe('API');
  });

  test('a prefix that is not a whole word does not match', () => {
    expect(pageTitle('agentsfoo', sections)).toBe('Agentsfoo');
  });

  test('a route outside the menu falls back to its first word', () => {
    expect(pageTitle('settings-storage', sections)).toBe('Settings');
  });

  test('no route name', () => {
    expect(pageTitle(undefined, sections)).toBe('Admin');
    expect(pageTitle('', sections, 'Ranch')).toBe('Ranch');
  });
});
