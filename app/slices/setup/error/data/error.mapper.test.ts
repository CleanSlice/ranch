import { describe, expect, test } from 'bun:test';
import { ErrorMapper } from './error.mapper';

const map = (error: unknown) => new ErrorMapper().toErrorEntity(error);

// Error tracking reads `code` to tell the user's network from a server
// failure (CLEAN-218); the status alone cannot, it falls back to 500.
describe('ErrorMapper marks a request that never got an answer', () => {
  test('offline: no response, ERR_NETWORK', () => {
    const entity = map({ code: 'ERR_NETWORK', message: 'Network Error' });
    expect(entity.code).toBe('ERR_NETWORK');
    expect(entity.statusCode).toBe(500);
    expect(entity.isToast).toBe(true);
  });

  test('cancelled: no response, ERR_CANCELED', () => {
    expect(map({ code: 'ERR_CANCELED', message: 'canceled' }).code).toBe('ERR_CANCELED');
  });

  test('a server failure keeps an empty code', () => {
    const entity = map({
      code: 'ERR_BAD_RESPONSE',
      response: { status: 500, data: { message: 'Internal server error' } },
    });
    expect(entity.code).toBe('');
    expect(entity.statusCode).toBe(500);
    expect(entity.message).toBe('Internal server error');
  });

  test('an answer wins over a network code', () => {
    const entity = map({ code: 'ERR_NETWORK', response: { status: 502 } });
    expect(entity.code).toBe('');
    expect(entity.statusCode).toBe(502);
  });

  test('a bug inside a gateway is not mistaken for the network', () => {
    const entity = map(new TypeError('cannot read properties of undefined'));
    expect(entity.code).toBe('');
    expect(entity.statusCode).toBe(500);
  });
});
