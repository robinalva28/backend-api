import type { NextFunction, Request, Response } from 'express';
import {
  isCancelOrderPath,
  rawRequestPath,
} from './cancel-order-request-path.js';
import { INVALID_CANCEL_REQUEST_MESSAGE } from './http-messages.js';

/**
 * Rejects any request body on the cancellation route before Nest registers
 * its JSON and URL-encoded parsers. Content-Length is checked directly;
 * Transfer-Encoding is not treated as proof of content, so chunked requests
 * are accepted only when the stream ends without data. This covers non-JSON
 * content and malformed JSON without depending on express.json.
 */
export function rejectCancelOrderBody(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (
    request.method !== 'POST' ||
    !isCancelOrderPath(rawRequestPath(request))
  ) {
    next();
    return;
  }

  const contentLength = readContentLength(request);

  if (contentLength === 'invalid' || contentLength === 'present') {
    reject(request, response);
    return;
  }

  if (hasTransferEncoding(request)) {
    inspectTransferEncodedBody(request, response, next);
    return;
  }

  next();
}

type ContentLengthState = 'absent' | 'zero' | 'present' | 'invalid';

function readContentLength(request: Request): ContentLengthState {
  const header = request.headers['content-length'];

  if (header === undefined || header === null) {
    return 'absent';
  }

  if (typeof header !== 'string') {
    return 'invalid';
  }

  const trimmed = header.trim();

  if (!/^[0-9]+$/.test(trimmed)) {
    return 'invalid';
  }

  return trimmed.replace(/^0+/, '').length > 0 ? 'present' : 'zero';
}

function hasTransferEncoding(request: Request): boolean {
  const header = request.headers['transfer-encoding'];

  if (header === undefined || header === null) {
    return false;
  }

  return typeof header !== 'string' || header.trim().length > 0;
}

function inspectTransferEncodedBody(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  let settled = false;

  const cleanup = (): void => {
    request.off('data', onData);
    request.off('end', onEnd);
    request.off('error', onError);
  };

  const finish = (action: () => void): void => {
    if (settled) {
      return;
    }

    settled = true;
    cleanup();
    action();
  };

  const onData = (chunk: Buffer | string): void => {
    if (chunk.length > 0) {
      finish(() => reject(request, response));
    }
  };
  const onEnd = (): void => {
    finish(next);
  };
  const onError = (error: Error): void => {
    finish(() => next(error));
  };

  request.on('data', onData);
  request.once('end', onEnd);
  request.once('error', onError);

  if (request.readableEnded) {
    finish(next);
  }
}

function reject(request: Request, response: Response): void {
  request.resume();
  response.status(400).json({ message: INVALID_CANCEL_REQUEST_MESSAGE });
}
