import type { NextFunction, Request, Response } from 'express';
import {
  isCancelOrderPath,
  rawRequestPath,
} from './cancel-order-request-path.js';
import { INVALID_CANCEL_REQUEST_MESSAGE } from './http-messages.js';

/**
 * Rejects malformed percent escapes before Express decodes route parameters.
 * The check is limited to the cancellation path, so other routes keep their
 * existing router behavior and error shape.
 */
export function rejectMalformedCancelOrderUrl(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (request.method !== 'POST') {
    next();
    return;
  }

  const path = rawRequestPath(request);

  if (!isCancelOrderPath(path) || isDecodable(path)) {
    next();
    return;
  }

  response.status(400).json({ message: INVALID_CANCEL_REQUEST_MESSAGE });
}

function isDecodable(path: string): boolean {
  try {
    decodeURIComponent(path);

    return true;
  } catch {
    return false;
  }
}
