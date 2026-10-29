import { describe, expect, it } from 'vitest';
import {
  isSubmitOrderPath,
  isSubmitOrderRequest,
} from '../../src/orders/infrastructure/http/submit-order-request-path.js';

describe('isSubmitOrderPath', () => {
  it.each([
    '/users/1/orders',
    '/users/0001/orders/',
    '/USERS/1/ORDERS',
    '/users/%31/orders',
  ])('recognizes %s', (path) => {
    expect(isSubmitOrderPath(path)).toBe(true);
  });

  it.each([
    '/users/1/orders/2',
    '/users/1/orders/2/cancel',
    '/users/1/orders/extra',
    '/users/1/orders?x=1',
    '//host/users/1/orders',
  ])('does not recognize %s', (path) => {
    expect(isSubmitOrderPath(path)).toBe(false);
  });
});

describe('isSubmitOrderRequest', () => {
  it('uses the pathname of an absolute request-target', () => {
    expect(
      isSubmitOrderRequest({
        originalUrl: 'http://example.test/users/1/orders?x=1',
      }),
    ).toBe(true);
  });

  it('falls back to url when originalUrl is absent', () => {
    expect(isSubmitOrderRequest({ url: '/users/1/orders' })).toBe(true);
  });
});
