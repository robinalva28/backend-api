import { BadRequestException } from '@nestjs/common';
import { INVALID_CANCEL_REQUEST_MESSAGE } from './http-messages.js';

const MAX_INT32 = '2147483647';

/**
 * Parses a route identifier lexically before converting it to a number.
 * Only ASCII digits are accepted, leading zeroes are allowed and the value
 * must fit the positive INT range used by the database.
 */
export function parseCancelOrderRouteId(value: string): number | null {
  if (!/^[0-9]+$/.test(value)) {
    return null;
  }

  const normalized = value.replace(/^0+/, '');

  if (
    normalized.length === 0 ||
    normalized.length > MAX_INT32.length ||
    (normalized.length === MAX_INT32.length && normalized > MAX_INT32)
  ) {
    return null;
  }

  const parsed = Number(normalized);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
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

  const parsed = parseCancelOrderRouteId(value);

  if (parsed === null) {
    throw invalidRequest();
  }

  return parsed;
}

function invalidRequest(): BadRequestException {
  return new BadRequestException(INVALID_CANCEL_REQUEST_MESSAGE);
}
