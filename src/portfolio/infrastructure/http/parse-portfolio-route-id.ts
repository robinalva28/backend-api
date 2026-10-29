import { BadRequestException } from '@nestjs/common';
import { parsePositiveInt32RouteId } from '../../../shared/parse-positive-int32-route-id.js';
import { INVALID_PORTFOLIO_REQUEST_MESSAGE } from './http-messages.js';

/**
 * Validates the portfolio route identifier before invoking the use case. The
 * controller filter owns the public response shape.
 */
export function requirePortfolioRouteId(value: unknown): number {
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
  return new BadRequestException(INVALID_PORTFOLIO_REQUEST_MESSAGE);
}
