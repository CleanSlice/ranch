import { describe, expect, test } from 'bun:test';
import {
  firstPlaceholderRange,
  hasPlaceholder,
  insertTemplate,
} from './insertTemplate';

describe('insertTemplate', () => {
  test('inserts into an empty draft and selects the first placeholder', () => {
    const r = insertTemplate('', 0, 'Restart the agent «name»');
    expect(r.text).toBe('Restart the agent «name»');
    expect(r.text.slice(r.selectionStart, r.selectionEnd)).toBe('«name»');
  });

  test('appends with a space after a draft that has no trailing whitespace', () => {
    const r = insertTemplate('Please', 6, 'Restart the agent «name»');
    expect(r.text).toBe('Please Restart the agent «name»');
    expect(r.text.slice(r.selectionStart, r.selectionEnd)).toBe('«name»');
  });

  test('does not double a space that is already there', () => {
    const r = insertTemplate('Please ', 7, 'Do «x»');
    expect(r.text).toBe('Please Do «x»');
  });

  test('inserts mid-draft with spaces on both sides', () => {
    const r = insertTemplate('ab', 1, 'Do «x»');
    expect(r.text).toBe('a Do «x» b');
    expect(r.text.slice(r.selectionStart, r.selectionEnd)).toBe('«x»');
  });

  test('selects the end of the insertion when the template has no placeholder', () => {
    const r = insertTemplate('', 0, 'List all agents');
    expect(r.selectionStart).toBe(r.selectionEnd);
    expect(r.selectionStart).toBe('List all agents'.length);
  });

  test('picks the first placeholder of the inserted text, not one from the draft', () => {
    const r = insertTemplate('«old» ', 6, 'Do «new»');
    expect(r.text.slice(r.selectionStart, r.selectionEnd)).toBe('«new»');
  });

  test('clamps a cursor outside the draft', () => {
    expect(insertTemplate('ab', 99, 'x').text).toBe('ab x');
    expect(insertTemplate('ab', -5, 'x').text).toBe('x ab');
  });
});

describe('placeholders', () => {
  test('finds ranges and reports presence', () => {
    expect(firstPlaceholderRange('a «b» c')).toEqual([2, 5]);
    expect(firstPlaceholderRange('a «b» c', 3)).toBe(null);
    expect(hasPlaceholder('none')).toBe(false);
    expect(hasPlaceholder('«»')).toBe(true);
  });
});
