import { describe, expect, it } from 'vitest';
import {
  extractRawPathname,
  isCancelOrderPath,
  rawRequestPath,
} from '../../src/orders/infrastructure/http/cancel-order-request-path.js';
import type { Request } from 'express';

describe('extractRawPathname', () => {
  it.each([
    ['/users/1/orders/2/cancel', '/users/1/orders/2/cancel'],
    ['/users/1/orders/2/cancel?next=1', '/users/1/orders/2/cancel'],
    ['/users/1/orders/2/cancel#fragment', '/users/1/orders/2/cancel'],
    [
      'http://127.0.0.1:3000/users/1/orders/2/cancel',
      '/users/1/orders/2/cancel',
    ],
    [
      'https://user:pass@example.test/users/0001/orders/0002/cancel?x=1',
      '/users/0001/orders/0002/cancel',
    ],
    [
      'HTTP://EXAMPLE.TEST/users/1/orders/2/cancel/',
      '/users/1/orders/2/cancel/',
    ],
    ['http://example.test', '/'],
    ['http://example.test?query=1', '/'],
    ['http://example.test#fragment', '/'],
    ['http://example.test/users/%ZZ/orders/2/cancel', '/users/%ZZ/orders/2/cancel'],
    [
      'http://example.test/users/1/orders/%E0%A4%A/cancel',
      '/users/1/orders/%E0%A4%A/cancel',
    ],
    [
      'http://example.test/users/1/orders/2/../2/cancel',
      '/users/1/orders/2/../2/cancel',
    ],
    ['//host/users/1/orders/2/cancel', '//host/users/1/orders/2/cancel'],
    ['*', '*'],
  ])('extracts %s as %s', (url, expected) => {
    expect(extractRawPathname(url)).toBe(expected);
  });
});

describe('rawRequestPath', () => {
  it('prefers originalUrl and preserves its raw pathname', () => {
    const request = {
      originalUrl: 'http://example.test/users/%ZZ/orders/2/cancel?x=1',
      url: '/ignored',
    } as Request;

    expect(rawRequestPath(request)).toBe('/users/%ZZ/orders/2/cancel');
  });

  it('falls back to url when originalUrl is absent', () => {
    const request = {
      url: '/users/1/orders/2/cancel',
    } as Request;

    expect(rawRequestPath(request)).toBe('/users/1/orders/2/cancel');
  });
});

describe('isCancelOrderPath', () => {
  it.each([
    '/users/1/orders/2/cancel',
    '/users/0001/orders/0002/cancel/',
    '/USERS/1/ORDERS/2/CANCEL',
    '/users/%ZZ/orders/2/cancel',
  ])('recognizes the cancellation shape %s', (path) => {
    expect(isCancelOrderPath(path)).toBe(true);
  });

  it.each([
    '/users/1/orders/2',
    '/users/1/orders/2/cancel/extra',
    '/users/1/orders/2/cancel?x=1',
    '//host/users/1/orders/2/cancel',
  ])('does not recognize the non-cancellation pathname %s', (path) => {
    expect(isCancelOrderPath(path)).toBe(false);
  });
});
