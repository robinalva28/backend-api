import { describe, expect, it } from 'vitest';
import {
  isPortfolioPath,
  isPortfolioRequest,
} from '../../src/portfolio/infrastructure/http/portfolio-request-path.js';

describe('isPortfolioPath', () => {
  it.each([
    '/users/1/portfolio',
    '/users/0001/portfolio/',
    '/USERS/1/PORTFOLIO',
  ])('recognizes %s', (path) => {
    expect(isPortfolioPath(path)).toBe(true);
  });

  it.each([
    '/users/1/portfolio/extra',
    '/users/1/portfolio/1',
    '/users/1/orders',
    '/instruments?query=portfolio',
  ])('does not recognize %s', (path) => {
    expect(isPortfolioPath(path)).toBe(false);
  });
});

describe('isPortfolioRequest', () => {
  it.each([
    { method: 'GET', url: '/users/1/portfolio' },
    { method: 'GET', url: '/users/0001/portfolio/' },
    { method: 'GET', url: '/USERS/1/PORTFOLIO?x=1' },
    { method: 'GET', url: 'http://example.test/users/1/portfolio' },
    {
      method: 'GET',
      originalUrl: 'http://example.test/users/1/portfolio?x=1',
      url: '/ignored',
    },
  ])('recognizes a GET portfolio request: $url', (request) => {
    expect(isPortfolioRequest(request)).toBe(true);
  });

  it.each([
    { method: 'POST', url: '/users/1/portfolio' },
    { method: 'HEAD', url: '/users/1/portfolio' },
    { method: 'GET', url: '/users/1/portfolio/extra' },
    { method: 'GET', url: '/users/1/orders' },
    { url: '/users/1/portfolio' },
  ])('rejects a non-GET or different path: $url', (request) => {
    expect(isPortfolioRequest(request)).toBe(false);
  });
});
