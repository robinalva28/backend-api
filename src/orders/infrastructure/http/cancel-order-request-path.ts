import type { Request } from 'express';

const CANCEL_ORDER_PATH = /^\/users\/[^/]+\/orders\/[^/]+\/cancel\/?$/i;
const ABSOLUTE_URI_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

export function isCancelOrderPath(path: string): boolean {
  return CANCEL_ORDER_PATH.test(path);
}

/**
 * Returns the raw pathname without query parameters or fragments. Absolute
 * request-targets (`scheme://authority/path`) are accepted with the same
 * pathname semantics Express uses for routing, while percent escapes are
 * preserved so they can be validated before the router decodes parameters.
 */
export function rawRequestPath(request: Request): string {
  const url = request.originalUrl ?? request.url ?? '';

  return extractRawPathname(url);
}

export function extractRawPathname(url: string): string {
  let pathStart = 0;
  const absolutePrefix = ABSOLUTE_URI_PREFIX.exec(url);

  if (absolutePrefix !== null) {
    const authorityStart = absolutePrefix[0].length;
    const pathStartOrQuery = findFirst(url, ['/', '?', '#'], authorityStart);

    if (pathStartOrQuery === -1 || url.charAt(pathStartOrQuery) !== '/') {
      return '/';
    }

    pathStart = pathStartOrQuery;
  }

  const pathEnd = findFirst(url, ['?', '#'], pathStart);

  return pathEnd === -1 ? url.slice(pathStart) : url.slice(pathStart, pathEnd);
}

function findFirst(
  value: string,
  characters: readonly string[],
  from: number,
): number {
  for (let index = from; index < value.length; index += 1) {
    if (characters.includes(value.charAt(index))) {
      return index;
    }
  }

  return -1;
}
