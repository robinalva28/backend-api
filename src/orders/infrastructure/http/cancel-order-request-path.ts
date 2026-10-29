import type { Request } from 'express';
import { rawRequestPath as readRawRequestPath } from './request-path.js';

const CANCEL_ORDER_PATH = /^\/users\/[^/]+\/orders\/[^/]+\/cancel\/?$/i;

export function isCancelOrderPath(path: string): boolean {
  return CANCEL_ORDER_PATH.test(path);
}

/**
 * Returns the raw pathname without query parameters or fragments, preserving
 * percent escapes until they can be validated before routing.
 */
export function rawRequestPath(request: Request): string {
  return readRawRequestPath(request);
}

export { extractRawPathname } from './request-path.js';
