import { describe, expect, test } from 'bun:test';
import { registryNumber } from './registryNumber';

describe('registryNumber', () => {
  test('takes the first eight letters and digits of a uuid, in two groups', () => {
    expect(registryNumber('7f3a9c1e-52b4-4d0a-9e61-0c8f2ab41d77')).toBe('7F3A·9C1E');
  });

  test('skips punctuation and upper-cases what is left', () => {
    expect(registryNumber('user_ab-12:cd/34ef')).toBe('USER·AB12');
  });

  test('prints what there is when the id is short', () => {
    expect(registryNumber('ab-cde')).toBe('ABCD·E');
    expect(registryNumber('a1b')).toBe('A1B');
    expect(registryNumber('abcd')).toBe('ABCD');
  });

  test('is empty when there is nothing to print', () => {
    expect(registryNumber('')).toBe('');
    expect(registryNumber('--- ::')).toBe('');
    expect(registryNumber(null)).toBe('');
    expect(registryNumber(undefined)).toBe('');
  });
});
