import { rawRequestPath } from './request-path.js';

const SUBMIT_ORDER_PATH = /^\/users\/[^/]+\/orders\/?$/i;

export function isSubmitOrderPath(path: string): boolean {
  return SUBMIT_ORDER_PATH.test(path);
}

export function isSubmitOrderRequest(request: {
  readonly originalUrl?: string;
  readonly url?: string;
}): boolean {
  return isSubmitOrderPath(rawRequestPath(request));
}
