import { describe, expect, test } from 'bun:test';

import { AuthErrorMapper } from './authError.mapper';

// What the console says for itself travels as a key, so it can be translated.
// What the server said travels untouched, so it can be found in the logs.
const mapper = new AuthErrorMapper();

type Mapped = { messageKey: string; serverMessage: string | null; code: string };
const map = (error: unknown) => mapper.toErrorEntity(error) as unknown as Mapped;

const response = (status: number, data?: unknown) => ({ response: { status, data } });

describe('the console’s own message is a key', () => {
  test('no network', () => {
    expect(map({ code: 'ERR_NETWORK' }).messageKey).toBe('account.error_network');
    expect(map({}).messageKey).toBe('account.error_network');
    expect(map(null).messageKey).toBe('account.error_network');
  });

  test('401 about the session', () => {
    const mapped = map(response(401, { code: 'SESSION_EXPIRED' }));
    expect(mapped.messageKey).toBe('account.error_session_ended');
    expect(mapped.code).toBe('SESSION_EXPIRED');
    expect(map(response(401, { code: 'TOKEN_INVALID' })).messageKey).toBe(
      'account.error_session_ended',
    );
  });

  test('401 about the credentials', () => {
    expect(map(response(401)).messageKey).toBe('account.error_bad_credentials');
    expect(map(response(401, { code: 'OTHER' })).messageKey).toBe(
      'account.error_bad_credentials',
    );
  });

  test('429', () => {
    expect(map(response(429)).messageKey).toBe('account.error_too_many_attempts');
  });

  test('403', () => {
    expect(map(response(403)).messageKey).toBe('account.error_forbidden');
  });

  test('anything else', () => {
    expect(map(response(500)).messageKey).toBe('account.error_unknown');
    expect(map(response(418)).messageKey).toBe('account.error_unknown');
  });

  test('the mapper writes no sentence of its own', () => {
    const errors = [
      { code: 'ERR_NETWORK' },
      response(401),
      response(401, { code: 'SESSION_EXPIRED' }),
      response(429),
      response(403),
      response(500),
    ].map((e) => mapper.toErrorEntity(e));

    for (const error of errors) {
      expect(/^account\.error_[a-z_]+$/.test(error.message)).toBe(true);
      expect((error as unknown as Mapped).serverMessage).toBe(null);
    }
  });
});

describe('what the server said is carried as received', () => {
  const sentence = '  Registration is disabled — ask an admin.  ';

  test('403, 5xx and a session 401 keep the sentence, character for character', () => {
    expect(map(response(403, { message: sentence })).serverMessage).toBe(sentence);
    expect(map(response(500, { message: sentence })).serverMessage).toBe(sentence);
    expect(
      map(response(401, { code: 'SESSION_EXPIRED', message: sentence })).serverMessage,
    ).toBe(sentence);
  });

  test('a sentence in another language is kept too', () => {
    expect(map(response(403, { message: 'Регистрация закрыта' })).serverMessage).toBe(
      'Регистрация закрыта',
    );
  });

  test('`detail` and `error` are read when there is no `message`', () => {
    expect(map(response(500, { detail: 'db down' })).serverMessage).toBe('db down');
    expect(map(response(500, { error: 'Bad Gateway' })).serverMessage).toBe('Bad Gateway');
  });

  test('a list of messages is joined', () => {
    expect(
      map(response(400, { message: ['email must be an email', 'password too short'] }))
        .serverMessage,
    ).toBe('email must be an email password too short');
  });

  test('the key is still set, for when the sentence is not shown', () => {
    expect(map(response(403, { message: sentence })).messageKey).toBe(
      'account.error_forbidden',
    );
  });

  test('wrong credentials and rate limits use the console’s wording, as before', () => {
    // A 401 on sign-in is always "wrong email or password", whatever the body
    // says: the API's text there is about tokens, not about what was typed.
    expect(map(response(401, { message: 'Unauthorized' })).serverMessage).toBe(null);
    expect(map(response(429, { message: 'ThrottlerException' })).serverMessage).toBe(null);
  });
});
