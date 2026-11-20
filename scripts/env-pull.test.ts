import { describe, expect, test } from 'bun:test';

import { mergeEnv, parseEnv, renderEnv } from './env-pull';

/**
 * `.env.project` is a copy of what Infisical holds (CLEAN-241). Its readers
 * take everything after the first `=` as the value, so the file is written
 * bare, and a pull must never lose a key that only the local file has.
 */
describe('env-pull', () => {
  test('reads pairs, skips comments, takes one pair of quotes off', () => {
    const env = parseEnv('# login\nA=1\r\nB="two words"\nC=\'x=y\'\n\nnot a pair\nD=');

    expect(env).toEqual({ A: '1', B: 'two words', C: 'x=y', D: '' });
  });

  test('keeps a quote that is part of the value', () => {
    expect(parseEnv(`A="half\nB=it's`)).toEqual({ A: '"half', B: "it's" });
  });

  test('Infisical wins, and a key it does not have is kept and named', () => {
    const { env, localOnly } = mergeEnv({ A: 'new', B: 'b' }, { A: 'old', Z: 'local' });

    expect(env).toEqual({ A: 'new', B: 'b', Z: 'local' });
    expect(localOnly).toEqual(['Z']);
  });

  test('writes bare values in key order, so a reader gets no quotes', () => {
    expect(renderEnv({ B: 'two words', A: 'x=y&z' })).toBe('A=x=y&z\nB=two words\n');
  });

  test('a file it wrote reads back the same', () => {
    const env = { TOKEN: 'abc', URL: 'https://example.test/?a=1&b=2' };

    expect(parseEnv(renderEnv(env))).toEqual(env);
  });

  test('refuses a value that spans lines and names the key', () => {
    expect(() => renderEnv({ CERT: 'a\nb' })).toThrow('CERT');
  });
});
