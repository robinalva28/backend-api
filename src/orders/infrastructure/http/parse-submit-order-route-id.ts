import { BadRequestException } from '@nestjs/common';
import { INVALID_SUBMIT_ORDER_REQUEST_MESSAGE } from './http-messages.js';
import { parsePositiveInt32RouteId } from './parse-route-id.js';

/**
 * Semantic validation used by the submission adapter before calling the use
 * case. The controller filter owns the public response shape.
 */
export function requireSubmitOrderRouteId(value: unknown): number {
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
  return new BadRequestException(INVALID_SUBMIT_ORDER_REQUEST_MESSAGE);
}
