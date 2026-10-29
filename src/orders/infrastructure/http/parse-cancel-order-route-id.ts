import { BadRequestException } from '@nestjs/common';
import { INVALID_CANCEL_REQUEST_MESSAGE } from './http-messages.js';
import { parsePositiveInt32RouteId } from './parse-route-id.js';

/**
 * Parses a cancellation route identifier with the shared positive INT rule.
 */
export function parseCancelOrderRouteId(value: string): number | null {
  return parsePositiveInt32RouteId(value);
}

/**
 * Semantic validation used by the HTTP adapter before calling the use case.
 * It throws Nest's BadRequestException because the controller filter owns the
 * public response shape.
 */
export function requireCancelOrderRouteId(value: unknown): number {
  if (typeof value !== 'string') {
    throw invalidRequest();
  }

  const parsed = parsePositiveInt32RouteId(value);

  if (parsed === null) {
    throw invalidRequest();
  }

  return parsed;
}

function invalidRequest(): BadRequestException {
  return new BadRequestException(INVALID_CANCEL_REQUEST_MESSAGE);
}
