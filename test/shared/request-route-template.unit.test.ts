import { describe, expect, it } from 'vitest';
import { resolveRequestRoute } from '../../src/shared/http/request-route-template.js';

describe('resolveRequestRoute', () => {
  it.each([
    ['/', { route: '/' }],
    ['/instruments', { route: '/instruments' }],
    ['/instruments/', { route: '/instruments' }],
    [
      '/users/42/portfolio',
      { route: '/users/:userId/portfolio', accountUserId: 42 },
    ],
    [
      '/users/0042/portfolio/',
      { route: '/users/:userId/portfolio', accountUserId: 42 },
    ],
    [
      '/users/42/orders',
      { route: '/users/:userId/orders', accountUserId: 42 },
    ],
    [
      '/users/42/orders/81/cancel',
      {
        route: '/users/:userId/orders/:orderId/cancel',
        accountUserId: 42,
        orderId: 81,
      },
    ],
    ['/docs', { route: '/docs' }],
    ['/docs/', { route: '/docs' }],
    ['/docs/swagger-ui.css', { route: '/docs' }],
    ['/openapi.json', { route: '/openapi.json' }],
  ])('maps %s to its template', (pathname, expected) => {
    expect(resolveRequestRoute(pathname)).toEqual(expected);
    expect(resolveRequestRoute(pathname.toUpperCase())).toEqual(expected);
  });

  it.each([
    ['/users/not-a-number/portfolio', '/users/:userId/portfolio', undefined],
    ['/users/0/portfolio', '/users/:userId/portfolio', undefined],
    ['/users/2147483648/portfolio', '/users/:userId/portfolio', undefined],
    [
      '/users/42/orders/0/cancel',
      '/users/:userId/orders/:orderId/cancel',
      42,
    ],
    ['/unknown/42', '<unmatched>', undefined],
  ])('does not copy invalid or unmatched identifiers from %s', (pathname, expectedRoute, expectedAccount) => {
    const route = resolveRequestRoute(pathname);

    expect(route.accountUserId).toBe(expectedAccount);
    expect(route.orderId).toBeUndefined();
    expect(route.route).toBe(expectedRoute);
    expect(resolveRequestRoute(pathname.toUpperCase())).toEqual(route);
  });

  it('decodes percent-encoded identifiers before validation', () => {
    expect(resolveRequestRoute('/users/%34%32/portfolio')).toEqual({
      route: '/users/:userId/portfolio',
      accountUserId: 42,
    });
  });

  it('omits identifiers whose escapes cannot be decoded', () => {
    expect(resolveRequestRoute('/users/%ZZ/portfolio')).toEqual({
      route: '/users/:userId/portfolio',
    });
  });

  it('never returns the raw path or query string', () => {
    expect(
      resolveRequestRoute('/users/42/portfolio?token=secret').route,
    ).toBe('<unmatched>');
    expect(resolveRequestRoute('/users/42/portfolio').route).toBe(
      '/users/:userId/portfolio',
    );
  });
});
