import { describe, expect, test } from 'bun:test';
import { skillFolder, slugError, slugify } from './slugify';

describe('slugify', () => {
  test('lowercase, non-alphanumerics to dashes, collapsed, trimmed', () => {
    expect(slugify('DevOps Engineer!')).toBe('devops-engineer');
    expect(slugify('  Mazda — Year  Resolution ')).toBe('mazda-year-resolution');
    expect(slugify('PDF/parsing v2')).toBe('pdf-parsing-v2');
  });

  test('leading digits stay, empty stays empty', () => {
    expect(slugify('2026 plans')).toBe('2026-plans');
    expect(slugify('!!!')).toBe('');
    expect(slugify('')).toBe('');
  });
});

describe('slugError', () => {
  test('required, then format', () => {
    expect(slugError('')).toBe('Name is required');
    expect(slugError('   ')).toBe('Name is required');
    expect(slugError('-devops')).toBe('Use lowercase letters, digits and dashes');
    expect(slugError('Dev Ops')).toBe('Use lowercase letters, digits and dashes');
    expect(slugError('devops-2')).toBe(null);
  });
});

describe('skillFolder', () => {
  test('the agent path', () => {
    expect(skillFolder('devops')).toBe('.agent/skills/devops/');
  });
});
