import { describe, expect, test } from 'bun:test';

import { noticeParams } from './noticeParams';

const english = (bytes: number) => `${bytes / (1024 * 1024)} MB`;
const russian = (bytes: number) => `${bytes / (1024 * 1024)} МБ`;
const TEN_MB = 10 * 1024 * 1024;

describe('noticeParams', () => {
  test('a byte count becomes a size under the name without the suffix', () => {
    const notice = { key: 'chat.error_size', params: { name: 'a.pdf', limitBytes: TEN_MB } };
    expect(noticeParams(notice, english)).toEqual({ name: 'a.pdf', limit: '10 MB' });
  });

  test('the same notice reads in whatever language is active when it is shown', () => {
    const notice = { key: 'chat.error_total', params: { limitBytes: TEN_MB } };
    expect(noticeParams(notice, english)).toEqual({ limit: '10 MB' });
    expect(noticeParams(notice, russian)).toEqual({ limit: '10 МБ' });
  });

  test('everything else passes through untouched', () => {
    const notice = {
      key: 'chat.error_message',
      params: { message: 'Agent runtime: context overflow', count: 5, code: 'AGENT_OFFLINE' },
    };
    expect(noticeParams(notice, english)).toEqual({
      message: 'Agent runtime: context overflow',
      count: 5,
      code: 'AGENT_OFFLINE',
    });
  });

  test('a text value is never taken for a byte count, whatever its name', () => {
    const notice = { key: 'x', params: { limitBytes: 'ten' } };
    expect(noticeParams(notice, english)).toEqual({ limitBytes: 'ten' });
  });

  test('no parameters is an empty object', () => {
    expect(noticeParams({ key: 'chat.error' }, english)).toEqual({});
  });
});
