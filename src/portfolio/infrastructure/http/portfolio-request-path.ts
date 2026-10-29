import type { Request } from 'express';
import { rawRequestPath } from '../../../shared/http/request-path.js';

const PORTFOLIO_PATH = /^\/users\/[^/]+\/portfolio\/?$/i;

export function isPortfolioPath(path: string): boolean {
  return PORTFOLIO_PATH.test(path);
}

export function isPortfolioRequest(request: {
  readonly method?: string;
  readonly originalUrl?: string;
  readonly url?: string;
}): boolean {
  return request.method === 'GET' && isPortfolioPath(rawRequestPath(request));
}

export function rawPortfolioRequestPath(request: Request): string {
  return rawRequestPath(request);
}
