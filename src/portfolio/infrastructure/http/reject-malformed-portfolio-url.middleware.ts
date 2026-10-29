import type { NextFunction, Request, Response } from 'express';
import { INVALID_PORTFOLIO_REQUEST_MESSAGE } from './http-messages.js';
import {
  isPortfolioPath,
  rawPortfolioRequestPath,
} from './portfolio-request-path.js';

/**
 * Rejects malformed percent escapes before Express decodes the portfolio
 * route parameter. The check is limited to GET portfolio paths, so other
 * routes keep their existing router behavior and error shape.
 */
export function rejectMalformedPortfolioUrl(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (request.method !== 'GET') {
    next();
    return;
  }

  const path = rawPortfolioRequestPath(request);

  if (!isPortfolioPath(path) || isDecodable(path)) {
    next();
    return;
  }

  response
    .status(400)
    .json({ message: INVALID_PORTFOLIO_REQUEST_MESSAGE });
}

function isDecodable(path: string): boolean {
  try {
    decodeURIComponent(path);

    return true;
  } catch {
    return false;
  }
}
